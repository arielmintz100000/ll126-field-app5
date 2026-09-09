// GET /api/task?taskId=86ey99gg0
// Returns everything the field app needs to pre-fill the dispatch screen.
//
// Why this exists: the project task on its own only carries Address, BBL,
// Client Contact and Project Phase. Site Contact, Phone, Building Type and
// Entity live on the related Buildings record, and Block / Lot are encoded
// inside the BBL. This endpoint stitches all three sources together so the
// inspector sees real data instead of "Not Set", with no ClickUp automation
// required.

import {
  PROJECTS_LIST_ID,
  BUILDINGS_LIST_ID,
  PROJECT_FIELDS,
  BUILDING_FIELDS,
  CONDITION_FIELDS,
  INFO_FIELDS,
} from './_fields.js';
import {
  cu,
  getTask,
  getListFields,
  fieldValue,
  locationText,
  dropdownLabel,
  optionNames,
  sendError,
  HttpError,
} from './_clickup.js';

// A BBL is 1 borough digit + 5 block digits + 4 lot digits.
function splitBbl(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 10) return { block: null, lot: null };
  return {
    block: String(parseInt(digits.slice(1, 6), 10)),
    lot: String(parseInt(digits.slice(6, 10), 10)),
  };
}

function bblDigits(raw) {
  if (raw === null || raw === undefined) return '';
  const text = typeof raw === 'object' ? locationText(raw) || '' : String(raw);
  return text.replace(/\D/g, '');
}

function isoDate(ms) {
  const n = Number(ms);
  if (!n) return null;
  return new Date(n).toISOString().slice(0, 10);
}

async function findBuildingByBbl(targetDigits, addressText) {
  if (!targetDigits && !addressText) return null;
  const wantedAddress = (addressText || '').trim().toLowerCase();

  for (let page = 0; page < 12; page += 1) {
    const data = await cu(
      `/list/${BUILDINGS_LIST_ID}/task?page=${page}&subtasks=false&include_closed=true`
    );
    const tasks = data?.tasks || [];
    if (!tasks.length) return null;

    for (const t of tasks) {
      if (targetDigits) {
        const raw = (t.custom_fields || []).find((f) => f.id === BUILDING_FIELDS.bbl)?.value;
        if (bblDigits(raw) === targetDigits) return t;
      }
    }
    // Address fallback, only if no BBL matched anywhere.
    if (wantedAddress) {
      for (const t of tasks) {
        const addr = locationText(
          (t.custom_fields || []).find((f) => f.id === PROJECT_FIELDS.address)?.value
        );
        if (addr && addr.trim().toLowerCase() === wantedAddress) return t;
      }
    }
    if (data.last_page) return null;
  }
  return null;
}

export default async function handler(req, res) {
  try {
    const taskId = (req.query?.taskId || '').trim();
    if (!taskId) throw new HttpError(400, 'Missing taskId in the URL.');

    const task = await getTask(taskId);

    const bblRaw = fieldValue(task, PROJECT_FIELDS.bbl);
    const digits = bblDigits(bblRaw);
    const { block, lot } = splitBbl(digits);
    const address = locationText(fieldValue(task, PROJECT_FIELDS.address));

    let building = null;
    try {
      building = await findBuildingByBbl(digits, address);
    } catch {
      building = null; // A missing building record must never block an inspection.
    }

    const bField = (id) => (building ? fieldValue(building, id) : null);

    // value + source, so the UI can label where each value came from and leave
    // anything still unknown as an empty, editable input.
    const val = (value, source) =>
      value === null || value === undefined || value === ''
        ? { value: '', source: null }
        : { value: String(value), source };

    const listFields = await getListFields(PROJECTS_LIST_ID).catch(() => ({ fields: [] }));
    const defOf = (id) => (listFields.fields || []).find((f) => f.id === id);

    res.status(200).json({
      ok: true,
      taskId: task.id,
      taskName: task.name,
      taskUrl: task.url,
      projectPhase: dropdownLabel(task, PROJECT_FIELDS.projectPhase),
      buildingRecord: building ? { id: building.id, name: building.name } : null,
      building: {
        address: val(address, 'project'),
        bin: val(fieldValue(task, PROJECT_FIELDS.bin), 'project'),
        bbl: val(digits, 'project'),
        block: val(block, 'derived'),
        lot: val(lot, 'derived'),
        dateOfInspection: val(
          isoDate(fieldValue(task, PROJECT_FIELDS.dateOfInspection)),
          'project'
        ),
        entity: val(
          fieldValue(task, PROJECT_FIELDS.entity) || bField(BUILDING_FIELDS.entity),
          fieldValue(task, PROJECT_FIELDS.entity) ? 'project' : 'building'
        ),
        clientContact: val(fieldValue(task, PROJECT_FIELDS.clientContact), 'project'),
        zip: val(
          fieldValue(task, PROJECT_FIELDS.zip) ||
            (address && (address.match(/\b\d{5}\b/) || [])[0]) ||
            '',
          fieldValue(task, PROJECT_FIELDS.zip) ? 'project' : 'derived'
        ),
        siteContact: (() => {
          const own = fieldValue(task, PROJECT_FIELDS.siteContact);
          return val(own || bField(BUILDING_FIELDS.siteContact), own ? 'project' : 'building');
        })(),
        sitePhone: (() => {
          const own = fieldValue(task, PROJECT_FIELDS.phone);
          return val(own || bField(BUILDING_FIELDS.phone), own ? 'project' : 'building');
        })(),
        buildingType: (() => {
          const own = dropdownLabel(task, PROJECT_FIELDS.buildingType);
          return val(own || bField(BUILDING_FIELDS.buildingType), own ? 'project' : 'building');
        })(),
        billingAddress: val(fieldValue(task, PROJECT_FIELDS.billingAddress), 'project'),
      },
      options: {
        materials: optionNames(defOf(PROJECT_FIELDS.parapetMaterials)),
        condition: optionNames(defOf(CONDITION_FIELDS.north)),
        phase: optionNames(defOf(PROJECT_FIELDS.projectPhase)),
        buildingType: optionNames(defOf(PROJECT_FIELDS.buildingType)),
        score: optionNames(defOf(PROJECT_FIELDS.parapetScore)),
      },
      existingNotes: {
        north: fieldValue(task, INFO_FIELDS.north) || '',
        east: fieldValue(task, INFO_FIELDS.east) || '',
        south: fieldValue(task, INFO_FIELDS.south) || '',
        west: fieldValue(task, INFO_FIELDS.west) || '',
      },
    });
  } catch (err) {
    sendError(res, err);
  }
}
