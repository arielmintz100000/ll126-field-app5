// Thin wrapper around the ClickUp v2 API.
// The token lives ONLY here, server-side, and is never sent to the browser.

const BASE = 'https://api.clickup.com/api/v2';

export function token() {
  const t = process.env.CLICKUP_API_TOKEN;
  if (!t) throw new HttpError(500, 'CLICKUP_API_TOKEN is not set on the server.');
  return t;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function cu(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: token(),
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = (data && (data.err || data.error || data.message)) || `ClickUp returned ${res.status}`;
    throw new HttpError(res.status, msg);
  }
  return data;
}

export function getTask(taskId) {
  return cu(`/task/${encodeURIComponent(taskId)}?include_subtasks=false`);
}

export function getListFields(listId) {
  return cu(`/list/${encodeURIComponent(listId)}/field`);
}

export function setField(taskId, fieldId, value) {
  return cu(`/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(fieldId)}`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}

// Reads a custom field value off a task payload by field id.
export function fieldValue(task, fieldId) {
  const f = (task.custom_fields || []).find((x) => x.id === fieldId);
  if (!f) return null;
  const v = f.value;
  if (v === undefined || v === null || v === '') return null;
  return v;
}

// Location fields store { location: {lat,lng}, formatted_address }
export function locationText(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.formatted_address || null;
}

// Dropdown fields store the selected option's orderindex or id depending on age
// of the field, so resolve against the field definition to get a clean label.
export function dropdownLabel(task, fieldId) {
  const f = (task.custom_fields || []).find((x) => x.id === fieldId);
  if (!f || f.value === undefined || f.value === null || f.value === '') return null;
  const opts = (f.type_config && f.type_config.options) || [];
  const byId = opts.find((o) => o.id === f.value);
  if (byId) return byId.name;
  const byIndex = opts[Number(f.value)];
  return byIndex ? byIndex.name : null;
}

// Turns a list-field definition into { "Option Name": "option-uuid" }
export function optionMap(fieldDef) {
  const out = {};
  const opts = (fieldDef && fieldDef.type_config && fieldDef.type_config.options) || [];
  for (const o of opts) out[o.name] = o.id;
  return out;
}

export function optionNames(fieldDef) {
  const opts = (fieldDef && fieldDef.type_config && fieldDef.type_config.options) || [];
  return opts.map((o) => o.name);
}

export function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ ok: false, error: err.message || 'Unexpected server error' });
}
