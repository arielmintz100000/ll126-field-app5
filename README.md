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

**5. Parapet Score is a real dropdown.** It was an Emoji (rating) field that
could only hold a number, so scores were stored as 1/2/3. It is now a
Safe / SWARMP / Unsafe dropdown and the app writes the actual label.

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

## Troubleshooting

### "Unexpected token 'T', \"The page c\"... is not valid JSON"

The app loaded, but `/api/task` returned Vercel's HTML 404 page instead of
data. The static files deployed and the serverless functions did not.

**Confirm it:** open `https://<your-app>.vercel.app/api/health` in a browser.

| What you see | What it means | Fix |
| --- | --- | --- |
| Vercel's "page could not be found" | The functions never deployed | Repo layout, below |
| `"tokenPresent": false` | The env var is missing | Add `CLICKUP_API_TOKEN`, redeploy |
| `"tokenLooksValid": false` | ClickUp rejected the token | Regenerate it, update Vercel, redeploy |
| `"ok": true` with a username | Everything is wired | Re-open the inspect link |

**The repo layout.** `index.html` and `api/` must sit at the very top level of
the repository, as siblings:

```
your-repo/
├── index.html        <- top level, not in a subfolder
├── app.js
├── styles.css
├── vercel.json
└── api/
    ├── task.js
    ├── health.js
    ├── submit.js
    └── upload.js
```

If GitHub shows a single `ll126-field-app` folder when you open the repo,
everything is one level too deep. That is why the page loads (Vercel still
finds an index) while `/api/*` 404s. Two ways out:

- Re-upload: unzip first, then drag **the files inside** the folder, not the
  folder itself.
- Or leave it and tell Vercel where to look: **Settings → General → Root
  Directory → `ll126-field-app` → Save**, then redeploy.

**Also worth checking:** after adding or changing an environment variable you
must redeploy. Vercel does not apply it to an existing deployment.

---

## Known ClickUp-side gaps

None of these break the app; they are limits of the current field setup.
(ZIP, Site Contact, Phone and Building Type were added to the Projects list on
2026-09-09, so all four now persist when an inspector fills them in. Parapet
Score was also replaced with a Safe / SWARMP / Unsafe dropdown on the same day.)

**One manual cleanup left:** the old Emoji-type `Parapet Score` field still
exists on the Projects list and is now unused. Delete it in ClickUp (List
settings → Custom Fields) so there is only one field with that name. It holds
no data on any task, so nothing is lost.

1. **Inspector Signature** is uploaded as a task attachment. ClickUp's Signature
   custom field cannot be set through the public API.
2. **360 video over ~4 MB** cannot go through the upload function (Vercel's
   request limit). The app says so and asks the inspector to attach it from
   ClickUp instead.
3. **Defect selections** are written into the per-elevation Info text field,
   since no multi-select defect field exists yet. This is the open question
   with Patrick — per-elevation vs. one global field.

---

## Files

```
index.html        app shell
app.js            the whole 8-step wizard
styles.css        dark rooftop UI
api/task.js       GET  prefill: project task + building record + derived values
api/health.js     GET  deployment + token check, open it in a browser
api/upload.js     POST one photo / video / signature as a task attachment
api/submit.js     POST all findings, then flip Project Phase to Inspected
api/_fields.js    every ClickUp custom field ID, in one place
api/_clickup.js   ClickUp API wrapper, holds the token server-side
vercel.json       /inspect routing + security headers
```

Custom field IDs change if a field is deleted and recreated in ClickUp. When
that happens, `api/_fields.js` is the only file to edit.
