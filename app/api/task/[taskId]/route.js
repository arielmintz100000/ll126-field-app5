import { NextResponse } from "next/server";
import { findField, getTask, readFieldValue, resolveTaskId } from "@/lib/clickup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Fields shown on the dispatch-confirmation screen, in display order.
// Anything the List does not carry is hidden rather than shown as "not set".
const BUILDING_FIELDS = [
  ["address", "Address"],
  ["borough", "Borough"],
  ["zip", "ZIP"],
  ["bin", "BIN"],
  ["bbl", "BBL"],
  ["block", "Block"],
  ["lot", "Lot"],
  ["buildingType", "Building Type"],
  ["entity", "Entity"],
  ["clientContact", "Client Contact"],
  ["siteContact", "Site Contact"],
  ["phone", "Phone"],
  ["billingAddress", "Billing Address"],
  ["inspectionDate", "Date of Inspection"],
];

// Each entry is a set of acceptable names: the field is only reported missing
// when none of them exist on the List.
const WRITE_TARGETS = [
  ["North Parapet Condition"],
  ["East Parapet Condition"],
  ["South Parapet Condition"],
  ["West Parapet Condition"],
  ["North Parapet Info"],
  ["East Parapet Info"],
  ["South Parapet Info"],
  ["West Parapet Info"],
  ["Past Repairs"],
  ["Parapet Wall Materials", "Parapet Materials"],
  ["Coping Materials", "Coping Material"],
  ["Parapet Score"],
  ["Project Phase"],
];

export async function GET(_request, { params }) {
  const rawTaskId = params?.taskId;
  const taskId = resolveTaskId(rawTaskId);

  if (!taskId) {
    return NextResponse.json(
      { error: `Could not read a task id from "${rawTaskId}".` },
      { status: 400 }
    );
  }

  try {
    const task = await getTask(taskId);
    const customFields = task.custom_fields || [];

    const building = {};
    const present = {};
    for (const [key, fieldName] of BUILDING_FIELDS) {
      const field = findField(customFields, fieldName);
      present[key] = Boolean(field);
      building[key] = readFieldValue(field);
    }

    const missingFields = WRITE_TARGETS.filter(
      (names) => !names.some((n) => findField(customFields, n))
    ).map((names) => names[0]);

    // Selectable values straight from the workspace, so the app can never
    // offer a choice ClickUp will reject. Covers dropdowns and Labels fields.
    const optionsFor = (names, prefer = []) => {
      for (const name of [].concat(names)) {
        const f = findField(customFields, name, prefer);
        if (f && (f.type === "drop_down" || f.type === "labels")) {
          return (f.type_config?.options || []).map((o) => o.name || o.label);
        }
      }
      return null;
    };

    return NextResponse.json({
      taskId: task.id,
      taskName: task.name,
      taskUrl: task.url,
      listId: task.list?.id || null,
      listName: task.list?.name || null,
      status: task.status?.status || "",
      building,
      present,
      missingFields,
      options: {
        condition: optionsFor("North Parapet Condition"),
        wallMaterials: optionsFor(["Parapet Wall Materials", "Parapet Materials"], [
          "labels",
          "drop_down",
        ]),
        copingMaterials: optionsFor(["Coping Materials", "Coping Material"], [
          "labels",
          "drop_down",
        ]),
        score: optionsFor("Parapet Score", ["drop_down"]),
        projectPhase: optionsFor("Project Phase"),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err.message || "Could not load the task from ClickUp.",
        endpoint: err.endpoint,
        taskIdUsed: taskId,
      },
      { status: err.status || 500 }
    );
  }
}
