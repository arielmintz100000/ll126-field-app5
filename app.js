/* LL126 Field Inspector -- production client.
 *
 * Fixes shipped in this version:
 *   1. Building data is pulled live from ClickUp (project task + related
 *      Buildings record + values derived from the BBL). Nothing renders as
 *      "Not Set" any more.
 *   2. Every building field is editable. If ClickUp has no value the input is
 *      simply empty with a placeholder, and whatever the inspector types is
 *      written back to the task on submit.
 *   3. The Borough field is gone from the app and from the report payload.
 */

'use strict';

/* ------------------------------------------------------------------ config */

const STEPS = [
  { key: 'building',  label: 'Building' },
  { key: 'materials', label: 'Materials' },
  { key: 'north',     label: 'N' },
  { key: 'east',      label: 'E' },
  { key: 'south',     label: 'S' },
  { key: 'west',      label: 'W' },
  { key: 'summary',   label: 'Summary' },
  { key: 'signoff',   label: 'Sign off' },
];

const ELEVATIONS = { north: 'North', east: 'East', south: 'South', west: 'West' };

const DEFECTS = [
  'Displacement',
  'Horizontal or diagonal cracks',
  'Missing bricks',
  'Loose bricks',
  'Missing coping stones',
  'Loose coping stones',
  'Potential wiring issues',
];

const FALLBACK_CONDITIONS = ['Good Condition', 'Some Defects Present', 'Catastrophic Failure'];
const FALLBACK_MATERIALS = ['Brick', 'CMU', 'Stone', 'Cast-in-Place Concrete', 'Metal', 'Stucco/EIFS', 'Other'];

const CONDITION_TONE = {
  'Good Condition': 'good',
  'Some Defects Present': 'warn',
  'Catastrophic Failure': 'bad',
};

const CONDITION_HINT = {
  'Good Condition': 'Plumb within 1/8 of cross-sectional thickness, no excessive deterioration.',
  'Some Defects Present': 'Tag every defect you can see, then add notes.',
  'Catastrophic Failure': 'Describe the failure in notes. Notify DOB if there is a falling hazard.',
};

// Building fields shown on step 1. Borough is deliberately absent.
const BUILDING_FIELDS = [
  { key: 'address',          label: 'Address',          placeholder: 'Street address',       wide: true },
  { key: 'zip',              label: 'ZIP',              placeholder: '10013' },
  { key: 'bin',              label: 'BIN',              placeholder: '7-digit BIN', mode: 'numeric' },
  { key: 'bbl',              label: 'BBL',              placeholder: '10-digit BBL', mode: 'numeric' },
  { key: 'block',            label: 'Block',            placeholder: 'From BBL', readonly: true },
  { key: 'lot',              label: 'Lot',              placeholder: 'From BBL', readonly: true },
  { key: 'dateOfInspection', label: 'Inspection date',  placeholder: '', type: 'date' },
  { key: 'buildingType',     label: 'Building type',    placeholder: 'Select…', select: 'buildingType' },
  { key: 'entity',           label: 'Entity / owner',   placeholder: 'Owner entity',        wide: true },
  { key: 'siteContact',      label: 'Site contact',     placeholder: 'Name of super / contact' },
  { key: 'sitePhone',        label: 'Site phone',       placeholder: '(212) 555-0100', type: 'tel' },
  { key: 'clientContact',    label: 'Client contact',   placeholder: 'client@example.com', type: 'email', wide: true },
  { key: 'billingAddress',   label: 'Billing address',  placeholder: 'Billing / mailing address', wide: true },
];

const SRC_LABEL = { project: 'project', building: 'building rec', derived: 'from BBL' };

const MAX_PHOTO_PX = 1600;
const PHOTO_QUALITY = 0.72;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/* ------------------------------------------------------------------- state */

const params = new URLSearchParams(location.search);
const TASK_ID = (params.get('taskId') || params.get('task') || '').trim();
const DRAFT_KEY = `ll126:draft:${TASK_ID}`;

const state = {
  phase: 'loading', // loading | error | form | submitting | done
  error: '',
  step: 0,
  meta: null,
  options: {
    condition: FALLBACK_CONDITIONS,
    materials: FALLBACK_MATERIALS,
    buildingType: ['Residential', 'Commercial', 'Industrial', 'Institutional', 'Mixed-Use'],
    score: ['Safe', 'SWARMP', 'Unsafe'],
  },
  building: {},
  materials: '',
  pastRepairs: '',
  elevations: {},
  hazard: '',
  dobNotified: '',
  score: '',
  summaryNotes: '',
  inspectorName: '',
  inspectorFirm: 'Capitol Compliance LLC',
  inspectionMethod: '',
  signature: '',
  status: null, // { kind, text }
  result: null,
};

for (const dir of Object.keys(ELEVATIONS)) {
  state.elevations[dir] = { condition: '', defects: [], notes: '', photos: [] };
}

const app = document.getElementById('app');

/* ----------------------------------------------------------------- helpers */

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isFilled = (v) => v !== null && v !== undefined && String(v).trim() !== '';

function saveDraft() {
  if (!TASK_ID) return;
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        at: Date.now(),
        step: state.step,
        building: state.building,
        materials: state.materials,
        pastRepairs: state.pastRepairs,
        elevations: state.elevations,
        hazard: state.hazard,
        dobNotified: state.dobNotified,
        score: state.score,
        summaryNotes: state.summaryNotes,
        inspectorName: state.inspectorName,
        inspectorFirm: state.inspectorFirm,
        inspectionMethod: state.inspectionMethod,
        signature: state.signature,
      })
    );
  } catch {
    /* storage full or blocked -- the inspection still works, it just is not resumable */
  }
}

function loadDraft() {
  if (!TASK_ID) return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clean up */ }
}

function setStatus(kind, text) {
  state.status = kind ? { kind, text } : null;
  paintStatus();
}

/* Derive Block / Lot the moment a BBL is typed or corrected. */
function syncBblParts() {
  const digits = String(state.building.bbl || '').replace(/\D/g, '');
  if (digits.length === 10) {
    state.building.block = String(parseInt(digits.slice(1, 6), 10));
    state.building.lot = String(parseInt(digits.slice(6, 10), 10));
  } else {
    state.building.block = '';
    state.building.lot = '';
  }
}

/* When the API route is missing, Vercel answers with an HTML 404 page. Parsing
 * that as JSON used to surface as "Unexpected token 'T'", which tells the
 * inspector nothing. Read the response as text first and translate it. */
async function readApi(res, path) {
  const raw = await res.text();
  const looksHtml = /^\s*</.test(raw) || /could not be found/i.test(raw);

  if (looksHtml) {
    if (res.status === 404) {
      throw new Error(
        `The server route ${path} is missing (404). The app's files deployed but the api folder did not. ` +
          `Check that api/ sits at the top level of the repository, next to index.html.`
      );
    }
    throw new Error(`The server returned a web page instead of data (HTTP ${res.status}) for ${path}.`);
  }

  if (!raw.trim()) throw new Error(`The server returned an empty response for ${path} (HTTP ${res.status}).`);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Could not read the server's reply for ${path}: ${raw.slice(0, 90)}`);
  }

  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  return data;
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  if (!TASK_ID) {
    state.phase = 'error';
    state.error =
      'This link is missing its taskId. Open the app from the dispatch email so it knows which project to load.';
    return render();
  }

  try {
    const res = await fetch(`/api/task?taskId=${encodeURIComponent(TASK_ID)}`, { cache: 'no-store' });
    const data = await readApi(res, '/api/task');

    state.meta = {
      taskId: data.taskId,
      taskName: data.taskName,
      taskUrl: data.taskUrl,
      projectPhase: data.projectPhase,
      buildingRecord: data.buildingRecord,
    };
    state.sources = {};
    for (const [key, cell] of Object.entries(data.building || {})) {
      state.building[key] = cell && typeof cell === 'object' ? cell.value : cell || '';
      state.sources[key] = cell && typeof cell === 'object' ? cell.source : null;
    }
    if (data.options?.condition?.length) state.options.condition = data.options.condition;
    if (data.options?.materials?.length) state.options.materials = data.options.materials;
    if (data.options?.buildingType?.length) state.options.buildingType = data.options.buildingType;
    if (data.options?.score?.length) state.options.score = data.options.score;

    if (!isFilled(state.building.dateOfInspection)) {
      state.building.dateOfInspection = new Date().toISOString().slice(0, 10);
      state.sources.dateOfInspection = 'derived';
    }
    syncBblParts();

    const draft = loadDraft();
    if (draft && confirm('Resume the inspection you started on this building?')) {
      Object.assign(state, {
        materials: draft.materials ?? '',
        pastRepairs: draft.pastRepairs ?? '',
        hazard: draft.hazard ?? '',
        dobNotified: draft.dobNotified ?? '',
        score: draft.score ?? '',
        summaryNotes: draft.summaryNotes ?? '',
        inspectorName: draft.inspectorName ?? '',
        inspectorFirm: draft.inspectorFirm ?? state.inspectorFirm,
        inspectionMethod: draft.inspectionMethod ?? '',
        signature: draft.signature ?? '',
        step: draft.step ?? 0,
      });
      Object.assign(state.building, draft.building || {});
      for (const dir of Object.keys(ELEVATIONS)) {
        if (draft.elevations?.[dir]) state.elevations[dir] = draft.elevations[dir];
      }
      syncBblParts();
    } else if (draft) {
      clearDraft();
    }

    state.phase = 'form';
    render();
  } catch (err) {
    state.phase = 'error';
    state.error = err.message || 'Could not reach ClickUp.';
    render();
  }
}

/* ------------------------------------------------------------------ render */

function render() {
  if (state.phase === 'loading') {
    app.innerHTML = `<div class="center"><div><div class="spin"></div><p class="lede">Loading building data from ClickUp…</p></div></div>`;
    return;
  }

  if (state.phase === 'error') {
    app.innerHTML = `
      <div class="center">
        <div>
          <div class="note" data-kind="bad" style="text-align:left">
            <i>⚠</i><div><b>Could not load this inspection</b>${esc(state.error)}</div>
          </div>
          ${/is missing \(404\)|web page instead of data/.test(state.error)
            ? `<div class="note" data-kind="info" style="text-align:left"><i>🛠</i><div><b>How to check</b>Open <code>/api/health</code> on this same domain. If that also shows a Vercel 404 page, the api folder never deployed.</div></div>`
            : ''}
          <button class="link-btn" onclick="location.reload()">Try again</button>
        </div>
      </div>`;
    return;
  }

  if (state.phase === 'done') return renderDone();

  const stepKey = STEPS[state.step].key;
  app.innerHTML = `
    ${headerHtml()}
    <main>${stepHtml(stepKey)}</main>
    ${navHtml()}
    <div id="strip"></div>`;

  bind(stepKey);
  paintStatus();
  window.scrollTo(0, 0);
}

function headerHtml() {
  const pct = ((state.step + 1) / STEPS.length) * 100;
  return `
    <header class="hdr">
      <div class="hdr-row">
        <div class="mark">CC</div>
        <div class="hdr-title">
          <b>LL126 Field</b>
          <span>${esc(state.building.address || state.meta?.taskName || 'Parapet inspection')}</span>
        </div>
        <div class="step-count">${state.step + 1}/${STEPS.length}</div>
      </div>
      <nav class="rail">
        ${STEPS.map((s, i) => {
          const st = i === state.step ? 'active' : i < state.step ? 'done' : 'todo';
          return `<button type="button" data-goto="${i}" data-state="${st}">${esc(s.label)}</button>`;
        }).join('')}
      </nav>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </header>`;
}

function navHtml() {
  const last = state.step === STEPS.length - 1;
  const busy = state.phase === 'submitting';
  return `
    <div class="nav">
      <button type="button" class="btn-back" data-nav="back" ${state.step === 0 ? 'disabled' : ''}>← Back</button>
      <button type="button" class="btn-next" data-nav="${last ? 'submit' : 'next'}"
        data-role="${last ? 'submit' : 'next'}" ${busy ? 'disabled' : ''}>
        ${busy ? 'Submitting…' : last ? 'Submit report' : 'Next →'}
      </button>
    </div>`;
}

function paintStatus() {
  const host = document.getElementById('strip');
  if (!host) return;
  if (!state.status) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="strip" data-kind="${esc(state.status.kind)}">${esc(state.status.text)}</div>`;
}

/* ------------------------------------------------------------- step: 1 building */

function fieldHtml(f) {
  const value = state.building[f.key] ?? '';
  const src = state.sources?.[f.key];
  const badge = isFilled(value)
    ? (src ? `<span class="src" data-src="${esc(src)}">${esc(SRC_LABEL[src] || src)}</span>` : '')
    : `<span class="src" data-src="empty">add on site</span>`;

  if (f.select) {
    const opts = state.options[f.select] || [];
    return `
      <div class="f ${f.wide ? 'wide' : ''}">
        <label for="b-${f.key}">${esc(f.label)} ${badge}</label>
        <select id="b-${f.key}" data-b="${f.key}">
          <option value="">${esc(f.placeholder)}</option>
          ${opts
            .map((o) => `<option value="${esc(o)}" ${value === o ? 'selected' : ''}>${esc(o)}</option>`)
            .join('')}
        </select>
      </div>`;
  }

  return `
    <div class="f ${f.wide ? 'wide' : ''}">
      <label for="b-${f.key}">${esc(f.label)} ${badge}</label>
      <input id="b-${f.key}" data-b="${f.key}"
        type="${f.type || 'text'}"
        ${f.mode ? `inputmode="${f.mode}"` : ''}
        ${f.readonly ? 'readonly' : ''}
        value="${esc(value)}"
        placeholder="${esc(f.placeholder)}" />
    </div>`;
}

function buildingStep() {
  const missing = BUILDING_FIELDS.filter((f) => !f.readonly && !isFilled(state.building[f.key]));
  const rec = state.meta?.buildingRecord;

  return `
    <h1>Dispatch confirmation</h1>
    <p class="lede">Pulled live from ClickUp. Check it against what you see on site and fix anything that is wrong: your edits are written back to the project task.</p>

    ${rec
      ? `<div class="note" data-kind="info"><i>🔗</i><div><b>Matched building record</b>${esc(rec.name)} — site contact, phone and building type came from there.</div></div>`
      : `<div class="note" data-kind="warn"><i>🔍</i><div><b>No matching building record</b>Nothing in the Buildings list matches this BBL, so site contact and building type are blank. Fill them in below.</div></div>`}

    ${missing.length
      ? `<div class="note" data-kind="warn"><i>✎</i><div><b>${missing.length} field${missing.length === 1 ? '' : 's'} still blank</b>${esc(missing.map((f) => f.label).join(', '))}. Type what you can confirm on site.</div></div>`
      : `<div class="note" data-kind="good"><i>✓</i><div><b>All building data present</b>Nothing missing before you start the walk.</div></div>`}

    <div class="card">
      <div class="card-hd"><h2>Building</h2><small>tap any field to edit</small></div>
      <div class="grid">${BUILDING_FIELDS.map(fieldHtml).join('')}</div>
    </div>

    <div class="note" data-kind="safety"><i>⚠️</i><div><b>Before you step out</b>Roof access clear, PPE on, and you are not working alone near an unstable parapet.</div></div>`;
}

/* ------------------------------------------------------- step: 2 materials */

function materialsStep() {
  return `
    <h1>Parapet construction</h1>
    <p class="lede">What is the parapet built from, and what repairs can you see?</p>

    <div class="card">
      <div class="card-hd"><h2>Materials</h2><small>pick one</small></div>
      <div class="chips">
        ${state.options.materials
          .map((m) => `<button type="button" class="chip" data-mat="${esc(m)}" aria-pressed="${state.materials === m}">${esc(m)}</button>`)
          .join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><h2>Past repairs</h2><small>optional</small></div>
      <textarea data-field="pastRepairs" placeholder="Any repairs visible on site, whenever they were done: repointed sections, replaced coping, patched cracks…">${esc(state.pastRepairs)}</textarea>
    </div>`;
}

/* ------------------------------------------------------ step: 3-6 elevations */

function elevationStep(dir) {
  const e = state.elevations[dir];
  const showDefects = e.condition === 'Some Defects Present';

  return `
    <h1>${esc(ELEVATIONS[dir])} elevation</h1>
    <p class="lede">Walk the ${esc(ELEVATIONS[dir].toLowerCase())} parapet, set its condition, then capture photos.</p>

    <div class="card">
      <div class="card-hd"><h2>Condition</h2><small>required</small></div>
      <div class="conds">
        ${state.options.condition
          .map(
            (c) => `
          <button type="button" class="cond" data-cond="${esc(c)}"
            data-tone="${esc(CONDITION_TONE[c] || 'warn')}" aria-pressed="${e.condition === c}">
            <em></em>
            <span>
              <strong>${esc(c)}</strong>
              ${CONDITION_HINT[c] ? `<br><small style="color:var(--text-dim)">${esc(CONDITION_HINT[c])}</small>` : ''}
            </span>
          </button>`
          )
          .join('')}
      </div>
    </div>

    ${showDefects
      ? `<div class="card">
          <div class="card-hd"><h2>Defects observed</h2><small>tap all that apply</small></div>
          <div class="chips">
            ${DEFECTS.map((d) => `<button type="button" class="chip" data-defect="${esc(d)}" aria-pressed="${e.defects.includes(d)}">${esc(d)}</button>`).join('')}
          </div>
        </div>`
      : ''}

    <div class="card">
      <div class="card-hd"><h2>Notes</h2><small>${e.condition === 'Catastrophic Failure' ? 'required' : 'optional'}</small></div>
      <textarea data-elev-notes placeholder="What you saw, where, and what you recommend.">${esc(e.notes)}</textarea>
    </div>

    <div class="card">
      <div class="card-hd"><h2>Photos</h2><small>${e.photos.length} captured</small></div>
      <div class="shots">
        ${e.photos
          .map((p, i) => `<div class="shot"><img src="${esc(p.dataUrl)}" alt="${esc(ELEVATIONS[dir])} parapet ${i + 1}"><button type="button" data-drop="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`)
          .join('')}
        <button type="button" class="add-shot" data-shoot><span>＋</span>Photo</button>
      </div>
      <input type="file" accept="image/*" capture="environment" multiple hidden data-shoot-input />
    </div>`;
}

/* --------------------------------------------------------- step: 7 summary */

function summaryStep() {
  const yesNo = (field, value) =>
    ['Yes', 'No']
      .map((o) => `<button type="button" class="chip" data-set="${field}" data-val="${o}" aria-pressed="${value === o}">${o}</button>`)
      .join('');

  return `
    <h1>Observation summary</h1>
    <p class="lede">The overall call for the building. This drives the report and what happens next.</p>

    <div class="card">
      <div class="card-hd"><h2>Parapet score</h2><small>required</small></div>
      <div class="chips">
        ${state.options.score
          .map((s) => `<button type="button" class="chip" data-set="score" data-val="${esc(s)}" aria-pressed="${state.score === s}">${esc(s)}</button>`)
          .join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><h2>Immediate falling hazard?</h2><small>required</small></div>
      <div class="chips">${yesNo('hazard', state.hazard)}</div>
    </div>

    ${state.hazard === 'Yes'
      ? `<div class="note" data-kind="bad"><i>⚠</i><div><b>Falling hazard observed</b>DOB must be notified and the sidewalk protected. Record it below before you leave.</div></div>
         <div class="card">
           <div class="card-hd"><h2>DOB notified?</h2><small>required</small></div>
           <div class="chips">${yesNo('dobNotified', state.dobNotified)}</div>
         </div>`
      : ''}

    <div class="card">
      <div class="card-hd"><h2>360 video</h2><small>optional</small></div>
      <p class="lede" style="margin:0 0 12px;font-size:14px">One continuous pass of the full roof perimeter.</p>
      ${state.video
        ? `<div class="note" data-kind="good" style="margin:0"><i>🎥</i><div><b>${esc(state.video.name)}</b>${(state.video.size / 1048576).toFixed(1)} MB ready to upload</div></div>`
        : `<button type="button" class="add-shot" style="aspect-ratio:auto;min-height:var(--tap);width:100%" data-video><span>🎥</span>Attach 360 video</button>`}
      <input type="file" accept="video/*" capture="environment" hidden data-video-input />
    </div>

    <div class="card">
      <div class="card-hd"><h2>General notes</h2><small>optional</small></div>
      <textarea data-field="summaryNotes" placeholder="Anything the elevation notes do not cover: access constraints, weather, adjacent conditions…">${esc(state.summaryNotes)}</textarea>
    </div>`;
}

/* --------------------------------------------------------- step: 8 signoff */

function signoffStep() {
  const rows = [];
  rows.push(['Address', state.building.address]);
  rows.push(['BBL', state.building.bbl]);
  rows.push(['BIN', state.building.bin]);
  rows.push(['Block / Lot', [state.building.block, state.building.lot].filter(Boolean).join(' / ')]);
  rows.push(['Inspection date', state.building.dateOfInspection]);
  rows.push(['Materials', state.materials]);
  for (const [dir, name] of Object.entries(ELEVATIONS)) {
    const e = state.elevations[dir];
    const bits = [e.condition || '—'];
    if (e.photos.length) bits.push(`${e.photos.length} photo${e.photos.length === 1 ? '' : 's'}`);
    rows.push([name, e.condition ? bits.join(' · ') : '']);
  }
  rows.push(['Parapet score', state.score]);
  rows.push(['Falling hazard', state.hazard]);

  return `
    <h1>Inspector sign-off</h1>
    <p class="lede">Check the summary, sign, and submit. Everything writes back to the project task in ClickUp.</p>

    <div class="card">
      <div class="card-hd"><h2>Review</h2><small>${esc(state.meta?.taskName || '')}</small></div>
      <dl class="rev">
        ${rows
          .map(
            ([k, v]) => `<div class="rev-row"><dt>${esc(k)}</dt><dd data-missing="${!isFilled(v)}">${isFilled(v) ? esc(v) : 'not recorded'}</dd></div>`
          )
          .join('')}
      </dl>
    </div>

    <div class="card">
      <div class="card-hd"><h2>Inspector</h2><small>required</small></div>
      <div class="grid">
        <div class="f wide">
          <label for="insp-name">Name</label>
          <input id="insp-name" data-field="inspectorName" value="${esc(state.inspectorName)}" placeholder="Inspector name" />
        </div>
        <div class="f wide">
          <label for="insp-firm">Firm</label>
          <input id="insp-firm" data-field="inspectorFirm" value="${esc(state.inspectorFirm)}" placeholder="Firm name" />
        </div>
        <div class="f wide">
          <label for="insp-method">Method / access</label>
          <input id="insp-method" data-field="inspectionMethod" value="${esc(state.inspectionMethod)}" placeholder="e.g. Close-up from roof level, hands-on" />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><h2>Signature</h2><small>${state.signature ? 'signed' : 'required'}</small></div>
      <div class="sig-wrap">
        <canvas class="sig" data-sig width="600" height="380"></canvas>
        <div class="sig-base"></div>
      </div>
      <button type="button" class="chip" style="margin-top:10px" data-sig-clear>Clear signature</button>
    </div>`;
}

function stepHtml(key) {
  if (key === 'building') return buildingStep();
  if (key === 'materials') return materialsStep();
  if (key === 'summary') return summaryStep();
  if (key === 'signoff') return signoffStep();
  return elevationStep(key);
}

/* -------------------------------------------------------------------- done */

function renderDone() {
  const r = state.result || {};
  const partial = (r.failed || []).length > 0;
  return void (app.innerHTML = `
    <div class="center">
      <div>
        <div class="done-mark">✓</div>
        <h1>Report submitted</h1>
        <p class="lede">${esc(state.building.address || 'The building')} is recorded${r.phaseMoved ? ' and the project moved to <b>Inspected</b>' : ''}.</p>
        ${partial
          ? `<div class="note" data-kind="warn" style="text-align:left"><i>!</i><div><b>${r.failed.length} field${r.failed.length === 1 ? '' : 's'} did not save</b>${esc(r.failed.join(' · '))}</div></div>`
          : ''}
        ${state.meta?.taskUrl ? `<a class="link-btn" href="${esc(state.meta.taskUrl)}">Open the project task</a>` : ''}
      </div>
    </div>`);
}

/* ------------------------------------------------------------------- bind */

function bind(stepKey) {
  app.querySelectorAll('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => {
      const i = Number(el.dataset.goto);
      if (i <= state.step) { state.step = i; saveDraft(); render(); }
      else if (validate(STEPS[state.step].key)) { state.step = i; saveDraft(); render(); }
    })
  );

  app.querySelector('[data-nav="back"]')?.addEventListener('click', () => {
    if (state.step > 0) { state.step -= 1; saveDraft(); render(); }
  });
  app.querySelector('[data-nav="next"]')?.addEventListener('click', () => {
    if (!validate(stepKey)) return;
    state.step = Math.min(state.step + 1, STEPS.length - 1);
    saveDraft();
    render();
  });
  app.querySelector('[data-nav="submit"]')?.addEventListener('click', submit);

  // Building inputs
  app.querySelectorAll('[data-b]').forEach((el) =>
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      state.building[el.dataset.b] = el.value;
      if (el.dataset.b === 'bbl') {
        syncBblParts();
        const blk = app.querySelector('[data-b="block"]');
        const lot = app.querySelector('[data-b="lot"]');
        if (blk) blk.value = state.building.block || '';
        if (lot) lot.value = state.building.lot || '';
      }
      saveDraft();
    })
  );

  // Plain state fields
  app.querySelectorAll('[data-field]').forEach((el) =>
    el.addEventListener('input', () => { state[el.dataset.field] = el.value; saveDraft(); })
  );

  // Materials
  app.querySelectorAll('[data-mat]').forEach((el) =>
    el.addEventListener('click', () => { state.materials = el.dataset.mat; saveDraft(); render(); })
  );

  // Yes/No + score chips
  app.querySelectorAll('[data-set]').forEach((el) =>
    el.addEventListener('click', () => { state[el.dataset.set] = el.dataset.val; saveDraft(); render(); })
  );

  if (ELEVATIONS[stepKey]) bindElevation(stepKey);
  if (stepKey === 'summary') bindVideo();
  if (stepKey === 'signoff') bindSignature();
}

function bindElevation(dir) {
  const e = state.elevations[dir];

  app.querySelectorAll('[data-cond]').forEach((el) =>
    el.addEventListener('click', () => {
      e.condition = el.dataset.cond;
      if (e.condition !== 'Some Defects Present') e.defects = [];
      saveDraft();
      render();
    })
  );

  app.querySelectorAll('[data-defect]').forEach((el) =>
    el.addEventListener('click', () => {
      const d = el.dataset.defect;
      e.defects = e.defects.includes(d) ? e.defects.filter((x) => x !== d) : [...e.defects, d];
      el.setAttribute('aria-pressed', e.defects.includes(d));
      saveDraft();
    })
  );

  app.querySelector('[data-elev-notes]')?.addEventListener('input', (ev) => {
    e.notes = ev.target.value;
    saveDraft();
  });

  const input = app.querySelector('[data-shoot-input]');
  app.querySelector('[data-shoot]')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    setStatus('busy', `Compressing ${files.length} photo${files.length === 1 ? '' : 's'}…`);
    for (const file of files) {
      try {
        e.photos.push({ name: file.name || `${dir}-${Date.now()}.jpg`, dataUrl: await shrink(file) });
      } catch {
        setStatus('bad', `Could not read ${file.name || 'that photo'}.`);
      }
    }
    setStatus(null);
    saveDraft();
    render();
  });

  app.querySelectorAll('[data-drop]').forEach((el) =>
    el.addEventListener('click', () => {
      e.photos.splice(Number(el.dataset.drop), 1);
      saveDraft();
      render();
    })
  );
}

function bindVideo() {
  const input = app.querySelector('[data-video-input]');
  app.querySelector('[data-video]')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    const file = (input.files || [])[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus('bad', `That video is ${(file.size / 1048576).toFixed(0)} MB. Attach it to the task from ClickUp instead.`);
      return;
    }
    setStatus('busy', 'Reading video…');
    state.video = { name: file.name || '360-video.mp4', size: file.size, type: file.type, dataUrl: await readAsDataUrl(file) };
    setStatus(null);
    render();
  });
}

function bindSignature() {
  const canvas = app.querySelector('[data-sig]');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#10151b';

  if (state.signature) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = state.signature;
  }

  let drawing = false;
  const at = (ev) => {
    const r = canvas.getBoundingClientRect();
    const p = ev.touches ? ev.touches[0] : ev;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const start = (ev) => { ev.preventDefault(); drawing = true; const p = at(ev); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (ev) => { if (!drawing) return; ev.preventDefault(); const p = at(ev); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const end = () => {
    if (!drawing) return;
    drawing = false;
    state.signature = canvas.toDataURL('image/png');
    saveDraft();
  };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);

  app.querySelector('[data-sig-clear]')?.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.signature = '';
    saveDraft();
    render();
  });
}

/* --------------------------------------------------------------- validation */

function validate(key) {
  if (ELEVATIONS[key]) {
    const e = state.elevations[key];
    if (!e.condition) { alert(`Set the ${ELEVATIONS[key].toLowerCase()} parapet condition before moving on.`); return false; }
    if (e.condition === 'Some Defects Present' && !e.defects.length) {
      alert('Tag at least one defect, or change the condition.');
      return false;
    }
    if (e.condition === 'Catastrophic Failure' && !isFilled(e.notes)) {
      alert('Catastrophic failure needs notes describing what you saw.');
      return false;
    }
    return true;
  }
  if (key === 'materials' && !state.materials) { alert('Pick the parapet material.'); return false; }
  if (key === 'summary') {
    if (!state.score) { alert('Set the parapet score.'); return false; }
    if (!state.hazard) { alert('Record whether there is an immediate falling hazard.'); return false; }
    if (state.hazard === 'Yes' && !state.dobNotified) { alert('Record whether DOB has been notified.'); return false; }
  }
  return true;
}

/* -------------------------------------------------------------- image utils */

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// Downscale + re-encode so a 12 MP phone photo lands well under the upload cap.
async function shrink(file) {
  const dataUrl = await readAsDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_PHOTO_PX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', PHOTO_QUALITY));
    };
    img.onerror = () => resolve(dataUrl); // fall back to the original bytes
    img.src = dataUrl;
  });
}

/* ------------------------------------------------------------------ submit */

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readApi(res, url);
}

function uploadOne(filename, dataUrl, contentType) {
  return postJson('/api/upload', { taskId: TASK_ID, filename, contentType, dataBase64: dataUrl });
}

async function submit() {
  if (!validate('summary')) return;
  if (!isFilled(state.inspectorName)) return void alert('Enter the inspector name.');
  if (!state.signature) return void alert('Sign the report before submitting.');

  state.phase = 'submitting';
  render();

  const total =
    Object.values(state.elevations).reduce((n, e) => n + e.photos.length, 0) +
    (state.video ? 1 : 0) +
    (state.signature ? 1 : 0);
  let done = 0;
  const tick = () => setStatus('busy', `Uploading ${++done} of ${total}…`);

  try {
    if (!navigator.onLine) throw new Error('offline');

    const payload = {
      taskId: TASK_ID,
      building: state.building,
      materials: state.materials,
      pastRepairs: state.pastRepairs,
      elevations: {},
      score: state.score,
      hazard: state.hazard,
      dobNotified: state.dobNotified,
      summaryNotes: state.summaryNotes,
      inspectorName: state.inspectorName,
      inspectorFirm: state.inspectorFirm,
      inspectionMethod: state.inspectionMethod,
    };

    for (const [dir, e] of Object.entries(state.elevations)) {
      const urls = [];
      for (const [i, photo] of e.photos.entries()) {
        tick();
        const up = await uploadOne(`${dir}-parapet-${i + 1}.jpg`, photo.dataUrl, 'image/jpeg');
        if (up.url) urls.push(up.url);
      }
      payload.elevations[dir] = {
        condition: e.condition,
        defects: e.defects,
        notes: e.notes,
        photoUrls: urls,
      };
    }

    if (state.video) {
      tick();
      await uploadOne(state.video.name, state.video.dataUrl, state.video.type || 'video/mp4');
    }

    tick();
    await uploadOne('inspector-signature.png', state.signature, 'image/png');

    setStatus('busy', 'Writing fields to ClickUp…');
    state.result = await postJson('/api/submit', payload);

    clearDraft();
    state.phase = 'done';
    setStatus(null);
    render();
  } catch (err) {
    state.phase = 'form';
    saveDraft();
    render();
    setStatus(
      'offline',
      err.message === 'offline' || !navigator.onLine
        ? 'No signal. Your work is saved on this phone: reopen the link once you have bars and submit again.'
        : `Submit failed: ${err.message}. Your work is saved, try again.`
    );
  }
}

window.addEventListener('online', () => {
  if (state.status?.kind === 'offline') setStatus('busy', 'Back online. Hit Submit report again.');
});

boot();
