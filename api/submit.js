// POST /api/submit
// Writes the completed inspection back onto the project task, then flips
// Project Phase to "Inspected".
//
// Dropdown option ids are resolved live from the list definition, so renaming
// or reordering options in ClickUp never breaks the app.

import {
  PROJECTS_LIST_ID,
  PROJECT_FIELDS,
  CONDITION_FIELDS,
  INFO_FIELDS,
  ELEVATIONS,
} from './_fields.js';
import { cu, getListFields, setField, optionMap, sendError, HttpError } from './_clickup.js';

export const config = { maxDuration: 60 };

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body was not valid JSON.');
  }
}

export default async function handler(req, res) {
  const written = [];
  const failed = [];

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    const body = await readJson(req);
    const taskId = (body.taskId || '').trim();
    if (!taskId) throw new HttpError(400, 'Missing taskId.');

    const listFields = await getListFields(PROJECTS_LIST_ID);
    const defOf = (id) => (listFields.fields || []).find((f) => f.id === id);

    // Records one field write, but never lets a single bad field abort the rest.
    async function write(label, fieldId, value) {
      if (value === undefined || value === null || value === '') return;
      try {
        await setField(taskId, fieldId, value);
        written.push(label);
      } catch (err) {
        failed.push(`${label}: ${err.message}`);
      }
    }

    async function writeDropdown(label, fieldId, optionName) {
      if (!optionName) return;
      const map = optionMap(defOf(fieldId));
      const optionId = map[optionName];
      if (!optionId) {
        failed.push(`${label}: "${optionName}" is not an option on that field in ClickUp`);
        return;
      }
      await write(label, fieldId, optionId);
    }

    // --- Building data the inspector corrected on site -----------------------
    const b = body.building || {};
    await write('BIN', PROJECT_FIELDS.bin, b.bin ? Number(String(b.bin).replace(/\D/g, '')) : '');
    await write('Entity', PROJECT_FIELDS.entity, b.entity);
    await write('Billing Address', PROJECT_FIELDS.billingAddress, b.billingAddress);
    await write('ZIP', PROJECT_FIELDS.zip, b.zip);
    await write('Site Contact', PROJECT_FIELDS.siteContact, b.siteContact);
    await write('Phone', PROJECT_FIELDS.phone, b.sitePhone);
    await writeDropdown('Building Type', PROJECT_FIELDS.buildingType, b.buildingType);
    if (b.dateOfInspection) {
      const ms = Date.parse(`${b.dateOfInspection}T12:00:00Z`);
      if (!Number.isNaN(ms)) await write('Date of Inspection', PROJECT_FIELDS.dateOfInspection, ms);
    }

    // --- Per-elevation findings ---------------------------------------------
    for (const dir of ELEVATIONS) {
      const e = (body.elevations && body.elevations[dir]) || {};
      await writeDropdown(
        `${dir} condition`,
        CONDITION_FIELDS[dir],
        e.condition
      );

      const parts = [];
      if (e.condition) parts.push(`Condition: ${e.condition}`);
      if (Array.isArray(e.defects) && e.defects.length) parts.push(`Defects: ${e.defects.join(', ')}`);
      if (e.notes) parts.push(`Notes: ${e.notes}`);
      if (Array.isArray(e.photoUrls) && e.photoUrls.length) {
        parts.push(`Photos: ${e.photoUrls.length} attached to this task`);
      }
      await write(`${dir} info`, INFO_FIELDS[dir], parts.join('\n'));
    }

    // --- Whole-building findings --------------------------------------------
    await write('Past Repairs', PROJECT_FIELDS.pastRepairs, body.pastRepairs);
    await writeDropdown('Parapet Materials', PROJECT_FIELDS.parapetMaterials, body.materials);

    await writeDropdown('Parapet Score', PROJECT_FIELDS.parapetScore, body.score);

    // --- Sign-off note -------------------------------------------------------
    const signOff = [];
    if (body.inspectorName) signOff.push(`Inspector: ${body.inspectorName}`);
    if (body.inspectorFirm) signOff.push(`Firm: ${body.inspectorFirm}`);
    if (body.inspectionMethod) signOff.push(`Method / access: ${body.inspectionMethod}`);
    if (body.score) signOff.push(`Parapet score: ${body.score}`);
    if (body.hazard) signOff.push(`Immediate falling hazard: ${body.hazard}`);
    if (body.dobNotified) signOff.push(`DOB notified: ${body.dobNotified}`);
    if (body.summaryNotes) signOff.push('', body.summaryNotes);

    if (signOff.length) {
      try {
        await cu(`/task/${encodeURIComponent(taskId)}/comment`, {
          method: 'POST',
          body: JSON.stringify({
            comment_text: `Field inspection submitted\n\n${signOff.join('\n')}`,
            notify_all: false,
          }),
        });
        written.push('Sign-off comment');
      } catch (err) {
        failed.push(`Sign-off comment: ${err.message}`);
      }
    }

    // --- Flip the phase last, so it only moves once the data has landed -----
    let phaseMoved = false;
    if (body.setPhaseInspected !== false) {
      const before = failed.length;
      await writeDropdown('Project Phase', PROJECT_FIELDS.projectPhase, 'Inspected');
      phaseMoved = failed.length === before;
    }

    res.status(200).json({ ok: true, written, failed, phaseMoved });
  } catch (err) {
    sendError(res, err);
  }
}
