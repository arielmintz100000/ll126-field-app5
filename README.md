# LL126 Field Inspector

Mobile web app for Capitol Compliance rooftop parapet inspections. An inspector
opens a dispatch link on their phone, walks the roof, and everything writes back
to the ClickUp project task.

---

## Why the old deploy showed `404: NOT_FOUND`

Vercel returns that error when a deployment builds fine but has no page at the
route you asked for. Two things caused it, and both are fixed here:

1. **There was no page at `/`.** This project now has `app/page.jsx`, so the bare
   domain always renders something.
2. **The app must sit at the top level of the repo.** `package.json` has to be in
   the repo root, not inside a nested folder. If you upload a folder that contains
   another folder, Vercel builds nothing and serves a 404.

When you upload to GitHub, drag in the **contents** of this folder (the
`app` folder, `components`, `lib`, `package.json`, and so on) - not the zipped
folder itself.

---

## Deploy it (about 10 minutes, all in a browser)

### 1. Put the code on GitHub

1. Sign in at [github.com](https://github.com), click **+** (top right) -> **New repository**
2. Name it `ll126-field-app`, leave the defaults, **Create repository**
3. On the next screen click **uploading an existing file**
4. Unzip this download and drag in **everything inside** the `ll126-field-app` folder
5. Click **Commit changes**

### 2. Deploy on Vercel

1. Sign in at [vercel.com](https://vercel.com) with **Continue with GitHub**
2. **Add New** -> **Project** -> **Import** next to `ll126-field-app`
3. Leave every setting alone. Framework should auto-detect as **Next.js**,
   and **Root Directory** must stay `./`
4. **Deploy**, wait about a minute

### 3. Add the ClickUp API token

1. In ClickUp: avatar (bottom left) -> **Settings** -> **Apps** -> **API Token** -> **Generate**, copy it
2. In Vercel: your project -> **Settings** -> **Environment Variables**
3. Name `CLICKUP_API_TOKEN`, paste the token as the value, **Save**
4. **Deployments** tab -> **...** on the newest one -> **Redeploy**

Open your `.vercel.app` URL. The home page tells you straight away whether the
token was picked up.

### 4. Point the dispatch automation at it

On the **Projects** list, the automation that fires when Project Phase becomes
**Dispatched** should send a link shaped like this:

```
https://YOUR-PROJECT.vercel.app/inspect?taskId={task_id}
```

That is the only place your Vercel URL needs to appear.

---

## What it does

**On load** it reads the task id from the URL, calls ClickUp, and pre-fills the
dispatch screen: Address, Borough, ZIP, BIN, BBL, Block, Lot, Building Type,
Entity, Client Contact, Site Contact, Billing Address, Date of Inspection. Any
field it cannot find is flagged on screen rather than silently skipped.

**Eight steps:** dispatch confirmation, materials + past repairs, then North,
East, South and West elevations (condition, defect chips, notes, photos),
then the overall score and 360 video, then inspector sign-off with a signature pad.

**Materials** are captured as two separate multi-select groups, since the coping
is often a different material from the wall under it: **Parapet wall** and
**Coping**, each offering Brick, CMU (Concrete Masonry Unit), Stone, Terra Cotta,
Cast-in-Place Concrete, Metal, Stucco/EIFS, and Other. At least one wall material
is required to move on; coping is optional.

**On submit** it uploads the photos, the video and the signature as task
attachments, writes each custom field, posts a sign-off comment, and finally
flips **Project Phase** to **Inspected**. Phase moves last on purpose, so your
downstream automations only fire once the data has actually landed.

**Offline:** typed answers are saved to the phone continuously and restored if
the browser reloads. Failed uploads stay queued and retry the moment signal
returns, and again when the inspector submits.

---

## Troubleshooting

### `Submit failed: validateListIDEx List ID invalid.`

ClickUp says that when it cannot place the task inside a List the token is
allowed to work in. Reading a task needs view access; writing a custom field
needs **edit** access, so a token that loads the dispatch screen fine can still
be refused at submit. In order of likelihood:

1. **The token's owner cannot edit the Projects list.** Generate
   `CLICKUP_API_TOKEN` from an account with full member access to
   Client Space > Projects, then redeploy. A guest or read-only member is the
   usual culprit.
2. **The dispatch link points at a task outside Projects.** The task must live
   on the Projects list, because that is where the parapet fields exist.
3. **The link carries something other than a bare task id.** A full task URL, a
   stray `{task_id}` placeholder, or trailing punctuation from the email all
   break the lookup. The app now strips these itself and retries the lookup as a
   custom task id, so this should no longer bite.

The submit screen now names the exact call that failed, its HTTP status, and
ClickUp's own message. Read that panel first: it tells you which of the three
above you are hitting. When a submit is refused, **nothing is written** and every
answer stays saved on the phone, so hitting retry after fixing the token loses
no work.

### Some fields write but others do not

The success screen lists each field that failed and why. A field reported as
`not on this list` was renamed or removed in ClickUp. A dropdown reported with
`is not an option` means the app sent a value the field does not offer, and the
message lists the options it does.

### A materials field wrote "with gaps"

A multi-select write reports this when some chosen materials matched options on
the Labels field and others did not, usually because the field is missing
`Terra Cotta` or the exact option wording differs. The message names the values
that had nowhere to go, and all of them are still recorded in the sign-off
comment.

---

## Field matching

Custom fields are matched by **name**, not by id, so nothing is hardcoded to one
workspace. Matching ignores case and spacing. The app expects these on the
Projects list:

`North / East / South / West Parapet Condition` · `North / East / South / West
Parapet Info` · `Parapet Wall Materials` · `Coping Materials` · `Past Repairs` ·
`Parapet Score` · `Project Phase`

### The two materials fields must be Labels type

Multi-select needs a **Labels** field: a single-select dropdown physically
cannot hold more than one value. Create both on the Projects list as Labels,
with these options:

> Brick · CMU (Concrete Masonry Unit) · Stone · Terra Cotta ·
> Cast-in-Place Concrete · Metal · Stucco/EIFS · Other

Until `Parapet Wall Materials` exists, the app falls back to the old
single-select `Parapet Materials` dropdown and writes only the first selection
there. Nothing is lost either way: the complete list of both wall and coping
materials is always written into the sign-off comment.

### Parapet Score wording

The app shows **Safe With a Repair and Maintenance Program** in full rather than
the SWARMP shorthand. On submit it tries the full wording first and falls back
to `SWARMP`, so it writes correctly whether or not the dropdown option in
ClickUp has been renamed yet.

Two fields on this list are both called **Parapet Score** (an emoji rating and a
Safe / SWARMP / Unsafe dropdown). The app deliberately writes the dropdown,
since that is what the report reads. Worth deleting the emoji one to avoid
confusion later.

Rename a field in ClickUp and it stops matching. The dispatch screen lists
anything missing before the inspector starts, and the submit response reports
anything that failed to write.

Photos attach to the task itself and their links are written into the matching
`<Direction> Parapet Info` field alongside the notes. That is deliberate:
ClickUp's attachment-type custom fields cannot be reliably set through the
public API, and attachments plus links never lose the photos.

---

## Notes

- The API token lives only in Vercel's environment variables. It is used inside
  `app/api/*` on the server and never reaches the browser.
- No paid services and no extra dependencies: Next.js, React, and nothing else.
- Optional `CLICKUP_TEAM_ID` environment variable, used for the custom-task-id
  fallback on lookups. Defaults to this workspace, so you can ignore it.
- Local development: `npm install`, put your token in `.env.local`
  (see `.env.example`), then `npm run dev`.
