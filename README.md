# LL126 Field Inspector — v2

Mobile web app inspectors open on-site. It reads the building data off the
ClickUp project task, lets the inspector record findings for all four
elevations, and writes everything back to the task.

No build step. No dependencies. Drag the files into GitHub, connect Vercel,
paste one token, done.

---

## What changed in v2

**1. "Not Set" is gone.** The dispatch screen now loads real data. The old
version only looked at the project task, which holds just Address, BBL, Client
Contact and Project Phase — everything else came back unset. v2 assembles the
building record from three sources:

| Source | Fields |
| --- | --- |
| Project task | Address, ZIP, BBL, BIN, Date of Inspection, Entity, Client Contact, Billing Address, Site Contact, Phone, Building Type |
| Related Buildings record (matched on BBL) | Site Contact, Phone, Building Type, Entity — used only when the project task is blank |
| Derived from the BBL | Block, Lot |

The project task always wins. The building record is a fallback, and each value
on screen is badged with which source it came from.

The BBL-matching means **no ClickUp automation is needed** to get site contact
and building type onto the screen. Each value is badged with where it came
from, so the inspector knows what is authoritative.

**2. Blank fields are editable, not stuck.** Anything still unknown renders as
an empty input with a placeholder. Whatever the inspector types is written back
to the project task on submit, so the data gap closes itself over time. The
dispatch screen also counts what is still blank at the top.

**3. Borough is removed** from the app and from the submitted report payload.

**4. The API token moved server-side.** The browser never sees it. All ClickUp
calls go through `/api/*` functions running on Vercel.

Also in this version: Block/Lot recalculate live when a BBL is corrected,
photos are compressed on the phone before upload, work is saved to the phone
after every keystroke and survives a lost connection, and dropdown options are
read live from ClickUp so renaming an option never breaks the app.

---

## Deploy

### 1. GitHub (2 min)
1. Sign up at [github.com](https://github.com), click **+** → **New repository**
2. Name it `ll126-field-app`, click **Create repository**
3. Click the **uploading an existing file** link
4. Drag in the **contents** of this folder (not the folder itself — `index.html`
   must land at the top level, with `api/` as a subfolder)
5. Click **Commit changes**

### 2. Vercel (2 min)
1. Sign up at [vercel.com](https://vercel.com) → **Continue with GitHub**
2. **Add New Project** → find `ll126-field-app` → **Import**
3. Leave every setting at its default → **Deploy**

### 3. The token (2 min)
1. In ClickUp: avatar (bottom left) → **Settings** → **Apps** → **API Token** → **Generate** → copy
2. In Vercel: your project → **Settings** → **Environment Variables**
3. Name `CLICKUP_API_TOKEN`, paste the token as the value, **Save**
4. **Deployments** tab → **…** on the latest → **Redeploy**

Then open `https://<your-project>.vercel.app/inspect?taskId=86ey99gg0` to test.

### 4. The dispatch automation
On the **Projects** list: Automations → when **Project Phase** changes to
**Dispatched** → send email, with this link in the body:

```
https://<your-project>.vercel.app/inspect?taskId={task_id}
```

---

## Known ClickUp-side gaps

None of these break the app; they are limits of the current field setup.
(ZIP, Site Contact, Phone and Building Type were added to the Projects list on
2026-09-09, so all four now persist when an inspector fills them in.)

1. **Parapet Score** is an Emoji (rating) field, so it can only hold a number.
   It is written as Safe = 1, SWARMP = 2, Unsafe = 3. Converting it to a
   Dropdown with those three names would be cleaner, and the app will pick the
   new options up automatically.
2. **Inspector Signature** is uploaded as a task attachment. ClickUp's Signature
   custom field cannot be set through the public API.
3. **360 video over ~4 MB** cannot go through the upload function (Vercel's
   request limit). The app says so and asks the inspector to attach it from
   ClickUp instead.
4. **Defect selections** are written into the per-elevation Info text field,
   since no multi-select defect field exists yet. This is the open question
   with Patrick — per-elevation vs. one global field.

---

## Files

```
index.html        app shell
app.js            the whole 8-step wizard
styles.css        dark rooftop UI
api/task.js       GET  prefill: project task + building record + derived values
api/upload.js     POST one photo / video / signature as a task attachment
api/submit.js     POST all findings, then flip Project Phase to Inspected
api/_fields.js    every ClickUp custom field ID, in one place
api/_clickup.js   ClickUp API wrapper, holds the token server-side
vercel.json       /inspect routing + security headers
```

Custom field IDs change if a field is deleted and recreated in ClickUp. When
that happens, `api/_fields.js` is the only file to edit.
