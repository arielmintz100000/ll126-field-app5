import { NextResponse } from "next/server";
import {
  clickupFetch,
  findField,
  getListFields,
  getTask,
  resolveTaskId,
  setCustomField,
} from "@/lib/clickup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const DIRECTIONS = [
  ["north", "North"],
  ["east", "East"],
  ["south", "South"],
  ["west", "West"],
];

// Builds the note body written into "<Direction> Parapet Info".
function composeNotes(entry) {
  if (!entry) return "";
  const parts = [];
  if (entry.condition) parts.push(`Condition: ${entry.condition}`);
  if (entry.defects?.length) parts.push(`Defects: ${entry.defects.join(", ")}`);
  if (entry.notes) parts.push(`Notes: ${entry.notes}`);
  if (entry.photoUrls?.length) {
    parts.push(`Photos:\n${entry.photoUrls.map((u) => `- ${u}`).join("\n")}`);
  }
  return parts.join("\n");
}

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const { elevations = {}, summary = {}, signOff = {}, listId } = payload || {};
  const rawTaskId = payload?.taskId;
  const taskId = resolveTaskId(rawTaskId);

  if (!taskId) {
    return NextResponse.json(
      {
        ok: false,
        stage: "task-id",
        error: `Could not read a task id from "${rawTaskId}". The dispatch link needs ?taskId=<id>.`,
      },
      { status: 400 }
    );
  }

  // Field definitions can come from the task or, if the task lookup fails,
  // straight from the List. Either is enough to keep writing.
  let fields = [];
  let taskUrl = null;
  const diagnostics = [];

  try {
    const task = await getTask(taskId);
    fields = task.custom_fields || [];
    taskUrl = task.url;
  } catch (err) {
    diagnostics.push({
      step: "load task",
      endpoint: err.endpoint,
      httpStatus: err.status,
      error: err.message,
    });

    if (listId) {
      try {
        fields = await getListFields(listId);
        diagnostics.push({ step: "load fields from list", endpoint: `GET /list/${listId}/field`, ok: true });
      } catch (listErr) {
        diagnostics.push({
          step: "load fields from list",
          endpoint: listErr.endpoint,
          httpStatus: listErr.status,
          error: listErr.message,
        });
      }
    }
  }

  if (!fields.length) {
    return NextResponse.json(
      {
        ok: false,
        stage: "load",
        taskIdReceived: rawTaskId,
        taskIdUsed: taskId,
        error:
          "Could not load the custom fields for this task, so nothing was written. Your answers are still saved on this phone.",
        diagnostics,
      },
      { status: 200 }
    );
  }

  const results = [];

  const write = async (fieldName, value, prefer = []) => {
    const field = findField(fields, fieldName, prefer);
    if (!field) {
      results.push({ field: fieldName, status: "missing", reason: "field not on this list" });
      return false;
    }
    const result = await setCustomField(taskId, field, value);
    results.push(result);
    return result.status === "ok" || result.status === "partial";
  };

  /**
   * Try each candidate name until one exists on the List. Lets the app follow
   * whichever naming the workspace actually uses without a redeploy.
   */
  const writeFirstField = async (fieldNames, value, prefer = []) => {
    for (const name of fieldNames) {
      if (findField(fields, name, prefer)) return write(name, value, prefer);
    }
    results.push({
      field: fieldNames[0],
      status: "missing",
      reason: `no field named ${fieldNames.join(" or ")} on this list`,
    });
    return false;
  };

  /**
   * Try each candidate value until one is accepted. "Safe With a Repair and
   * Maintenance Program" and the older "SWARMP" shorthand both mean the same
   * option, and which one exists depends on whether the dropdown was renamed.
   */
  const writeFirstValue = async (fieldName, values, prefer = []) => {
    const field = findField(fields, fieldName, prefer);
    if (!field) {
      results.push({ field: fieldName, status: "missing", reason: "field not on this list" });
      return;
    }
    let last = null;
    for (const value of values) {
      // eslint-disable-next-line no-await-in-loop
      last = await setCustomField(taskId, field, value);
      if (last.status === "ok" || last.status === "partial") break;
    }
    if (last) results.push(last);
  };

  // Per-elevation condition + notes
  for (const [key, label] of DIRECTIONS) {
    const entry = elevations[key];
    if (!entry) continue;
    if (entry.condition) await write(`${label} Parapet Condition`, entry.condition);
    const notes = composeNotes(entry);
    if (notes) await write(`${label} Parapet Info`, notes);
  }

  // Whole-building observations.
  // Wall and coping are separate, multi-select fields. A Labels field holds
  // several values; a single-select dropdown cannot, so if the List still only
  // has the old single "Parapet Materials" dropdown the selections are written
  // there as one combined value and the full list lands in the sign-off comment.
  const wallMaterials = summary.wallMaterials || [];
  const copingMaterials = summary.copingMaterials || [];

  if (wallMaterials.length) {
    await writeFirstField(
      ["Parapet Wall Materials", "Parapet Materials"],
      wallMaterials,
      ["labels", "drop_down"]
    );
  }
  if (copingMaterials.length) {
    await writeFirstField(["Coping Materials", "Coping Material"], copingMaterials, [
      "labels",
      "drop_down",
    ]);
  }

  if (summary.pastRepairs) await write("Past Repairs", summary.pastRepairs);

  // Two fields share the name "Parapet Score" on this list. The dropdown
  // (Safe / SWARMP / Unsafe) is the one the report reads.
  if (summary.score) {
    const scoreCandidates = [summary.score];
    if (/repair and maintenance/i.test(summary.score)) scoreCandidates.push("SWARMP");
    if (/^swarmp$/i.test(summary.score)) {
      scoreCandidates.push("Safe With a Repair and Maintenance Program");
    }
    await writeFirstValue("Parapet Score", scoreCandidates, ["drop_down", "emoji"]);
  }

  // Sign-off recorded as a comment so it is always captured, even if the
  // signature custom field type rejects a direct write.
  const signatureLines = [
    "**LL126 field inspection submitted**",
    signOff.inspectorName ? `Inspector: ${signOff.inspectorName}` : null,
    signOff.inspectorFirm ? `Firm: ${signOff.inspectorFirm}` : null,
    `Submitted: ${new Date().toISOString()}`,
    wallMaterials.length ? `Parapet wall materials: ${wallMaterials.join(", ")}` : null,
    copingMaterials.length ? `Coping materials: ${copingMaterials.join(", ")}` : null,
    summary.score ? `Parapet Score: ${summary.score}` : null,
    summary.videoUrl ? `360 Video: ${summary.videoUrl}` : null,
    signOff.signatureUrl ? `Signature: ${signOff.signatureUrl}` : null,
  ].filter(Boolean);

  try {
    await clickupFetch(`/task/${encodeURIComponent(taskId)}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_text: signatureLines.join("\n"), notify_all: true }),
    });
    results.push({ field: "Sign-off comment", status: "ok" });
  } catch (err) {
    results.push({
      field: "Sign-off comment",
      status: "failed",
      reason: err.message,
      endpoint: err.endpoint,
      httpStatus: err.status,
    });
  }

  // Last: flip the phase so downstream automations only fire once the
  // inspection data has actually landed.
  await write("Project Phase", "Inspected");

  const failed = results.filter((r) => r.status === "failed" || r.status === "missing");
  const partial = results.filter((r) => r.status === "partial");
  const wrote = results.filter((r) => r.status === "ok" || r.status === "partial");

  return NextResponse.json({
    ok: failed.length === 0,
    taskUrl,
    taskIdUsed: taskId,
    wroteCount: wrote.length,
    results,
    failed,
    partial,
    diagnostics,
  });
}
