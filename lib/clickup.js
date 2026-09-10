// Server-only helpers for talking to the ClickUp API.
// The API token never reaches the browser: every call runs inside /app/api routes.

export const CLICKUP_API = "https://api.clickup.com/api/v2";

// Workspace id, used for the custom-task-id fallback on task lookups.
export const TEAM_ID = process.env.CLICKUP_TEAM_ID || "90182559579";

export function getToken() {
  const token = (process.env.CLICKUP_API_TOKEN || "").trim();
  if (!token) {
    throw new Error(
      "CLICKUP_API_TOKEN is not set. Add it in Vercel > Settings > Environment Variables, then redeploy."
    );
  }
  return token;
}

/**
 * A ClickUp error that remembers which call produced it, so the field app can
 * show the failing endpoint instead of a bare message.
 */
export class ClickUpError extends Error {
  constructor(message, { endpoint, status, body } = {}) {
    super(message);
    this.name = "ClickUpError";
    this.endpoint = endpoint;
    this.status = status;
    this.body = body;
  }
}

export async function clickupFetch(path, options = {}) {
  const token = getToken();
  const endpoint = `${options.method || "GET"} ${path}`;

  let res;
  try {
    res = await fetch(`${CLICKUP_API}${path}`, {
      ...options,
      cache: "no-store",
      headers: { Authorization: token, ...(options.headers || {}) },
    });
  } catch (err) {
    throw new ClickUpError(`Network error reaching ClickUp: ${err.message}`, { endpoint });
  }

  const raw = await res.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { raw };
  }

  if (!res.ok) {
    const message =
      (body && (body.err || body.error || body.ECODE)) || `ClickUp returned ${res.status}`;
    throw new ClickUpError(message, { endpoint, status: res.status, body });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Task id handling
// ---------------------------------------------------------------------------

/**
 * Dispatch links are assembled by an automation and pasted into an email, so the
 * id can arrive wrapped in a URL, a template placeholder, quotes, or trailing
 * punctuation. Reduce whatever shows up to the bare task id.
 */
export function resolveTaskId(raw) {
  let id = String(raw ?? "").trim();
  if (!id) return "";

  // Full task URL: https://app.clickup.com/t/<team>/<taskId> or /t/<taskId>
  if (id.includes("://") || id.includes("app.clickup.com")) {
    const path = id.split("?")[0].split("#")[0].replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    const marker = parts.lastIndexOf("t");
    id = marker >= 0 && parts.length > marker + 1 ? parts[parts.length - 1] : parts[parts.length - 1];
  }

  // Strip an unresolved automation placeholder, quotes, brackets, whitespace,
  // and any trailing sentence punctuation the email may have added.
  id = id
    .replace(/^[{[("'`\s]+/, "")
    .replace(/[}\])"'`\s]+$/, "")
    .replace(/[.,;:!]+$/, "")
    .replace(/\s+/g, "");

  // Task ids are alphanumeric; custom ids may add a dash or underscore.
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
}

/**
 * Load a task, falling back to a custom-task-id lookup. ClickUp answers a
 * lookup it cannot place inside an accessible List with a List validation
 * error rather than a not-found, so both shapes are tried before giving up.
 */
export async function getTask(taskId) {
  const id = encodeURIComponent(taskId);
  try {
    return await clickupFetch(`/task/${id}?include_subtasks=false`);
  } catch (err) {
    try {
      return await clickupFetch(
        `/task/${id}?custom_task_ids=true&team_id=${encodeURIComponent(TEAM_ID)}`
      );
    } catch {
      throw err; // report the original, more meaningful failure
    }
  }
}

/** Custom field definitions for a List, used when a task lookup is unavailable. */
export async function getListFields(listId) {
  const body = await clickupFetch(`/list/${encodeURIComponent(listId)}/field`);
  return body?.fields || [];
}

// ---------------------------------------------------------------------------
// Custom field helpers
// ---------------------------------------------------------------------------

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Find a custom field by display name (case / spacing tolerant).
 *
 * Names are not unique in ClickUp: this Projects List carries two fields called
 * "Parapet Score", one emoji rating and one dropdown. `prefer` picks the type we
 * actually want instead of whichever happens to come back first.
 */
export function findField(customFields, name, prefer = []) {
  const target = normalize(name);
  const matches = (customFields || []).filter((f) => normalize(f.name) === target);
  if (!matches.length) return null;
  for (const type of prefer) {
    const hit = matches.find((f) => f.type === type);
    if (hit) return hit;
  }
  return matches[0];
}

/** Read a human-friendly value out of a ClickUp custom field object. */
export function readFieldValue(field) {
  if (!field || field.value === undefined || field.value === null || field.value === "") {
    return "";
  }

  switch (field.type) {
    case "drop_down": {
      const options = field.type_config?.options || [];
      const match =
        options.find((o) => o.id === field.value) ||
        options.find((o) => o.orderindex === field.value);
      return match ? match.name || match.label || "" : "";
    }
    case "labels": {
      const options = field.type_config?.options || [];
      const ids = Array.isArray(field.value) ? field.value : [field.value];
      return ids
        .map((id) => options.find((o) => o.id === id))
        .filter(Boolean)
        .map((o) => o.label || o.name)
        .join(", ");
    }
    case "location":
      return field.value?.formatted_address || "";
    case "date": {
      const ms = Number(field.value);
      if (!Number.isFinite(ms)) return "";
      return new Date(ms).toISOString().slice(0, 10);
    }
    case "users":
      return (field.value || []).map((u) => u.username || u.email).join(", ");
    case "currency":
    case "number":
      return String(field.value);
    default:
      if (typeof field.value === "object") return JSON.stringify(field.value);
      return String(field.value);
  }
}

/**
 * Turn a plain value from the field app into the shape ClickUp's
 * "set custom field value" endpoint expects for that field's type.
 * Returns null when the value should be skipped.
 */
export function buildFieldPayload(field, value) {
  if (value === undefined || value === null || value === "") return null;

  switch (field.type) {
    case "drop_down": {
      const options = field.type_config?.options || [];
      const target = normalize(value);
      // Exact first, then either direction of partial match, so "CMU" still
      // finds "CMU (Concrete Masonry Unit)".
      const match =
        options.find((o) => normalize(o.name || o.label) === target) ||
        options.find((o) => normalize(o.name || o.label).startsWith(target)) ||
        options.find((o) => normalize(o.name || o.label).includes(target)) ||
        options.find((o) => target.includes(normalize(o.name || o.label)));
      if (!match) {
        return {
          __unmatched: `"${value}" is not an option. Available: ${options
            .map((o) => o.name || o.label)
            .join(", ")}`,
        };
      }
      return { value: match.id };
    }
    case "labels": {
      const options = field.type_config?.options || [];
      const wanted = Array.isArray(value) ? value : [value];
      const ids = [];
      const unmatched = [];
      for (const raw of wanted) {
        const target = normalize(raw);
        if (!target) continue;
        // Same tiered match as dropdowns, so "CMU" still finds
        // "CMU (Concrete Masonry Unit)".
        const hit =
          options.find((o) => normalize(o.label || o.name) === target) ||
          options.find((o) => normalize(o.label || o.name).startsWith(target)) ||
          options.find((o) => normalize(o.label || o.name).includes(target)) ||
          options.find((o) => target.includes(normalize(o.label || o.name)));
        if (hit) {
          if (!ids.includes(hit.id)) ids.push(hit.id);
        } else {
          unmatched.push(raw);
        }
      }
      if (!ids.length) {
        return {
          __unmatched: `none of "${wanted.join(", ")}" are options. Available: ${options
            .map((o) => o.label || o.name)
            .join(", ")}`,
        };
      }
      return { value: ids, __partial: unmatched.length ? unmatched : undefined };
    }
    case "number":
    case "currency": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return { value: n };
    }
    case "emoji": {
      // Rating field: map the DOB wording onto the scale.
      const scale = { safe: 1, swarmp: 2, unsafe: 3 };
      const mapped = scale[normalize(value)];
      const n = mapped ?? Number(value);
      if (!Number.isFinite(n)) return null;
      const max = Number(field.type_config?.count) || 5;
      return { value: Math.min(n, max) };
    }
    case "date": {
      const ms = value instanceof Date ? value.getTime() : Date.parse(value);
      if (!Number.isFinite(ms)) return null;
      return { value: ms };
    }
    case "checkbox":
      return { value: Boolean(value) };
    default:
      return { value: String(value) };
  }
}

/**
 * Write one custom field. Never throws: returns a result record so one bad
 * field can never take down an inspector's whole submission.
 */
export async function setCustomField(taskId, field, value) {
  let payload;
  try {
    payload = buildFieldPayload(field, value);
  } catch (err) {
    return { field: field.name, status: "failed", reason: `value error: ${err.message}` };
  }

  if (!payload) {
    return { field: field.name, status: "skipped", reason: "nothing to write" };
  }
  if (payload.__unmatched) {
    return { field: field.name, status: "failed", reason: payload.__unmatched };
  }

  const { __partial: partial, ...bodyPayload } = payload;
  const endpoint = `POST /task/${taskId}/field/${field.id}`;
  try {
    await clickupFetch(`/task/${encodeURIComponent(taskId)}/field/${field.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });
    return partial
      ? {
          field: field.name,
          status: "partial",
          reason: `written, but these had no matching option: ${partial.join(", ")}`,
        }
      : { field: field.name, status: "ok" };
  } catch (err) {
    return {
      field: field.name,
      status: "failed",
      reason: err.message,
      endpoint: err.endpoint || endpoint,
      httpStatus: err.status,
    };
  }
}
