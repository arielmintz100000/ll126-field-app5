"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PhotoCapture from "@/components/PhotoCapture";
import SignaturePad from "@/components/SignaturePad";

const DIRECTIONS = [
  { key: "north", letter: "N", label: "North" },
  { key: "east", letter: "E", label: "East" },
  { key: "south", letter: "S", label: "South" },
  { key: "west", letter: "W", label: "West" },
];

const STEPS = [
  { id: "building", tab: "BLDG" },
  { id: "materials", tab: "MATL" },
  { id: "north", tab: "N" },
  { id: "east", tab: "E" },
  { id: "south", tab: "S" },
  { id: "west", tab: "W" },
  { id: "summary", tab: "SUM" },
  { id: "signoff", tab: "SIGN" },
];

const CONDITIONS = [
  {
    name: "Good Condition",
    tone: "good",
    sub: "Plumb within 1/8 of cross-sectional thickness. Report boilerplate auto-fills.",
  },
  {
    name: "Some Defects Present",
    tone: "defect",
    sub: "Tag every defect you can see below.",
  },
  {
    name: "Catastrophic Failure",
    tone: "fail",
    sub: "Describe it in the notes. Flag it before you leave the roof.",
  },
];

const DEFECTS = [
  "Displacement",
  "Horizontal or diagonal cracks",
  "Missing bricks",
  "Loose bricks",
  "Missing coping stones",
  "Loose coping stones",
  "Potential wiring issues",
];

// Multi-select: a parapet is often more than one material, and the coping is
// frequently a different one from the wall below it.
const MATERIALS = [
  "Brick",
  "CMU (Concrete Masonry Unit)",
  "Stone",
  "Terra Cotta",
  "Cast-in-Place Concrete",
  "Metal",
  "Stucco/EIFS",
  "Other",
];

const SCORES = [
  { name: "Safe", tone: "good", sub: "No hazardous condition observed." },
  {
    name: "Safe With a Repair and Maintenance Program",
    tone: "defect",
    // The ClickUp option may still be the "SWARMP" shorthand.
    aliases: ["SWARMP"],
    sub: "Repairs required, no immediate hazard.",
  },
  { name: "Unsafe", tone: "fail", sub: "Immediate notification required." },
];

const BUILDING_ROWS = [
  ["Address", "address", true],
  ["Borough", "borough", false],
  ["ZIP", "zip", false],
  ["BIN", "bin", false],
  ["BBL", "bbl", false],
  ["Block", "block", false],
  ["Lot", "lot", false],
  ["Building type", "buildingType", true],
  ["Entity", "entity", true],
  ["Site contact", "siteContact", false],
  ["Phone", "phone", false],
  ["Client contact", "clientContact", false],
  ["Inspection date", "inspectionDate", false],
  ["Billing address", "billingAddress", true],
];

const emptyElevation = () => ({ condition: "", defects: [], notes: "", photos: [] });

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export default function InspectPage() {
  const [taskId, setTaskId] = useState(null);
  const [load, setLoad] = useState({ state: "booting", data: null, error: null });
  const [step, setStep] = useState(0);
  const [online, setOnline] = useState(true);
  const [submit, setSubmit] = useState({ state: "idle", error: null, result: null });

  const [elevations, setElevations] = useState({
    north: emptyElevation(),
    east: emptyElevation(),
    south: emptyElevation(),
    west: emptyElevation(),
  });
  const [summary, setSummary] = useState({
    wallMaterials: [],
    copingMaterials: [],
    pastRepairs: "",
    score: "",
    video: [],
  });
  const [signOff, setSignOff] = useState({
    inspectorName: "",
    inspectorFirm: "Capitol Compliance",
    signature: null,
  });

  const restored = useRef(false);

  // -- boot: read taskId from the URL without useSearchParams, which keeps the
  //    route out of Next's static-generation Suspense requirement.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("taskId");
    setTaskId(id);
    if (!id) {
      setLoad({ state: "no-task", data: null, error: null });
      return;
    }
    let cancelled = false;
    setLoad({ state: "loading", data: null, error: null });
    fetch(`/api/task/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Task load failed (${res.status})`);
        return body;
      })
      .then((data) => !cancelled && setLoad({ state: "ready", data, error: null }))
      .catch((err) => !cancelled && setLoad({ state: "error", data: null, error: err.message }));
    return () => {
      cancelled = true;
    };
  }, []);

  // -- connectivity
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // every step starts at the top of the screen, not wherever the last one ended
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  const storageKey = taskId ? `ll126:${taskId}` : null;

  // -- restore typed work after a reload / phone lock
  useEffect(() => {
    if (!storageKey || restored.current) return;
    restored.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!saved) return;
      if (saved.elevations) {
        setElevations((prev) => {
          const next = { ...prev };
          for (const { key } of DIRECTIONS) {
            next[key] = { ...emptyElevation(), ...(saved.elevations[key] || {}), photos: [] };
          }
          return next;
        });
      }
      if (saved.summary) {
        setSummary((p) => ({
          ...p,
          ...saved.summary,
          wallMaterials: saved.summary.wallMaterials || [],
          copingMaterials: saved.summary.copingMaterials || [],
          video: [],
        }));
      }
      if (saved.signOff) setSignOff((p) => ({ ...p, ...saved.signOff }));
      if (typeof saved.step === "number") setStep(saved.step);
    } catch {
      /* corrupt cache is not worth blocking an inspection over */
    }
  }, [storageKey]);

  // -- persist typed work (files stay in memory; text survives anything)
  useEffect(() => {
    if (!storageKey) return;
    const slim = Object.fromEntries(
      DIRECTIONS.map(({ key }) => {
        const { photos, ...rest } = elevations[key];
        return [key, rest];
      })
    );
    const { video, ...summaryRest } = summary;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ elevations: slim, summary: summaryRest, signOff, step })
      );
    } catch {
      /* private mode / quota: not fatal */
    }
  }, [storageKey, elevations, summary, signOff, step]);

  // -- photo queue -----------------------------------------------------------
  const makeItems = (files) =>
    files.map((file) => ({
      id: newId(),
      file,
      name: file.name || "capture",
      kind: file.type.startsWith("video") ? "video" : "image",
      preview: file.type.startsWith("image") ? URL.createObjectURL(file) : null,
      state: "queued",
      url: null,
    }));

  const addElevationPhotos = (key, files) =>
    setElevations((prev) => ({
      ...prev,
      [key]: { ...prev[key], photos: [...prev[key].photos, ...makeItems(files)] },
    }));

  const removeElevationPhoto = (key, id) =>
    setElevations((prev) => ({
      ...prev,
      [key]: { ...prev[key], photos: prev[key].photos.filter((p) => p.id !== id) },
    }));

  const setItemState = useCallback((id, patch) => {
    setElevations((prev) => {
      const next = { ...prev };
      for (const { key } of DIRECTIONS) {
        next[key] = {
          ...next[key],
          photos: next[key].photos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        };
      }
      return next;
    });
    setSummary((prev) => ({
      ...prev,
      video: prev.video.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }, []);

  const uploadOne = useCallback(
    async (item) => {
      setItemState(item.id, { state: "uploading" });
      const form = new FormData();
      form.append("taskId", taskId);
      form.append("file", item.file, item.name);
      form.append("filename", item.name);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "upload failed");
        setItemState(item.id, { state: "done", url: body.url });
        return body.url;
      } catch {
        setItemState(item.id, { state: "queued" });
        return null;
      }
    },
    [taskId, setItemState]
  );

  const pending = useMemo(() => {
    const all = [];
    for (const { key } of DIRECTIONS) {
      all.push(...elevations[key].photos.filter((p) => p.state === "queued"));
    }
    all.push(...summary.video.filter((p) => p.state === "queued"));
    return all;
  }, [elevations, summary.video]);

  const flushQueue = useCallback(async () => {
    for (const item of pending) {
      // eslint-disable-next-line no-await-in-loop
      await uploadOne(item);
    }
  }, [pending, uploadOne]);

  // retry the queue whenever signal comes back
  useEffect(() => {
    if (online && taskId && pending.length) {
      flushQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, taskId, pending.length]);

  // -- submit ----------------------------------------------------------------
  const doSubmit = async () => {
    setSubmit({ state: "working", error: null, result: null });
    try {
      await flushQueue();

      let signatureUrl = null;
      if (signOff.signature) {
        const blob = await (await fetch(signOff.signature)).blob();
        const form = new FormData();
        form.append("taskId", taskId);
        form.append("file", blob, "inspector-signature.png");
        form.append("filename", "inspector-signature.png");
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (res.ok) signatureUrl = (await res.json()).url;
      }

      const body = {
        taskId,
        listId: load.data?.listId || null,
        elevations: Object.fromEntries(
          DIRECTIONS.map(({ key }) => [
            key,
            {
              condition: elevations[key].condition,
              defects: elevations[key].defects,
              notes: elevations[key].notes,
              photoUrls: elevations[key].photos.map((p) => p.url).filter(Boolean),
            },
          ])
        ),
        summary: {
          wallMaterials: summary.wallMaterials,
          copingMaterials: summary.copingMaterials,
          pastRepairs: summary.pastRepairs,
          score: summary.score,
          videoUrl: summary.video.map((v) => v.url).filter(Boolean).join(", "),
        },
        signOff: { ...signOff, signature: undefined, signatureUrl },
      };

      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();

      // The server reports a stage when it could not even reach the write step.
      // Nothing was sent to ClickUp, so keep every answer and show what broke.
      if (result?.stage) {
        setSubmit({ state: "blocked", error: result.error, result });
        return;
      }
      if (!res.ok) throw new Error(result.error || `Submit failed (${res.status})`);

      if (result.ok && storageKey) localStorage.removeItem(storageKey);
      setSubmit({ state: "done", error: null, result });
    } catch (err) {
      setSubmit({ state: "idle", error: err.message, result: null });
    }
  };

  // -- gating ---------------------------------------------------------------
  const current = STEPS[step];
  const canAdvance = (() => {
    if (current.id === "materials") return summary.wallMaterials.length > 0;
    if (DIRECTIONS.some((d) => d.key === current.id)) {
      return Boolean(elevations[current.id].condition);
    }
    if (current.id === "summary") return Boolean(summary.score);
    return true;
  })();

  // -- render ---------------------------------------------------------------
  if (load.state === "booting" || load.state === "loading") {
    return (
      <main className="center-state">
        <div className="spinner" />
        <p className="eyebrow">Capitol Compliance</p>
        <p className="step-lede" style={{ margin: 0 }}>Loading the project task…</p>
      </main>
    );
  }

  if (load.state === "no-task") {
    return (
      <main className="center-state">
        <p className="eyebrow">Missing task</p>
        <h1 className="step-title">No dispatch link</h1>
        <p className="step-lede">
          This screen needs a project task id. Open the app from the dispatch email.
        </p>
        <div className="code" style={{ textAlign: "left" }}>
          /inspect?taskId=86ey99gg0
        </div>
      </main>
    );
  }

  if (load.state === "error") {
    return (
      <main className="center-state">
        <p className="eyebrow">Could not load</p>
        <h1 className="step-title">Task unavailable</h1>
        <p className="step-lede">{load.error}</p>
        <button className="btn primary" style={{ maxWidth: 240 }} onClick={() => window.location.reload()}>
          Retry
        </button>
      </main>
    );
  }

  if (submit.state === "blocked") {
    const diags = submit.result?.diagnostics || [];
    return (
      <>
        <div className="hazard-tape" />
        <main className="shell">
          <div className="topbar">
            <span className="mark">CC</span>
            <span className="topbar-title">Nothing was written</span>
          </div>
          <div className="page">
            <p className="eyebrow">Submit blocked</p>
            <h1 className="step-title">ClickUp refused the task</h1>
            <p className="step-lede">{submit.error}</p>

            <div className="notice ok">
              <div>
                <strong>Your inspection is safe</strong>
                Every answer is still on this phone. Fix the cause below and hit retry.
              </div>
            </div>

            <div className="field">
              <span className="label">Task id used</span>
              <div className="code">{submit.result?.taskIdUsed || "none"}</div>
            </div>

            {diags.length > 0 && (
              <div className="field">
                <span className="label">Failing calls</span>
                {diags.map((d, i) => (
                  <div className="code" key={i} style={{ marginBottom: 8 }}>
                    {d.step}
                    {d.endpoint ? `\n${d.endpoint}` : ""}
                    {d.httpStatus ? `\nHTTP ${d.httpStatus}` : ""}
                    {d.error ? `\n${d.error}` : "\nok"}
                  </div>
                ))}
              </div>
            )}

            <div className="notice warn">
              <div>
                <strong>Usual cause</strong>
                The token in Vercel belongs to someone without edit access to the
                Projects list, or the dispatch link points at a task outside it.
              </div>
            </div>
          </div>

          <div className="footer">
            <div className="footer-inner">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSubmit({ state: "idle", error: null, result: null })}
              >
                Back
              </button>
              <button type="button" className="btn primary" onClick={doSubmit}>
                Retry submit
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (submit.state === "done") {
    const failed = submit.result?.failed || [];
    const partial = submit.result?.partial || [];
    return (
      <>
        <div className="hazard-tape" />
        <main className="center-state">
          <p className="eyebrow">Submitted</p>
          <h1 className="step-title">Report filed</h1>
          <p className="step-lede">
            {submit.result?.wroteCount || 0} field(s) written to the project task
            {failed.length === 0 ? " and the phase moved to Inspected." : "."}
          </p>
          {failed.length > 0 && (
            <div className="notice warn" style={{ textAlign: "left", maxWidth: 460 }}>
              <div>
                <strong>{failed.length} field(s) did not write</strong>
                {failed.map((f) => `${f.field} (${f.reason})`).join(" · ")}
              </div>
            </div>
          )}
          {partial.length > 0 && (
            <div className="notice warn" style={{ textAlign: "left", maxWidth: 460 }}>
              <div>
                <strong>{partial.length} field(s) written with gaps</strong>
                {partial.map((f) => `${f.field}: ${f.reason}`).join(" · ")}
              </div>
            </div>
          )}
          {submit.result?.taskUrl && (
            <a href={submit.result.taskUrl} target="_blank" rel="noreferrer">
              Open the task in ClickUp
            </a>
          )}
        </main>
      </>
    );
  }

  const building = load.data.building;
  // The three conditions are fixed by the DOB narrative logic. The submit route
  // matches them to whatever the dropdown is actually called in the workspace.
  const conditionOptions = CONDITIONS;
  const wallMaterialOptions = load.data.options?.wallMaterials?.length
    ? load.data.options.wallMaterials
    : MATERIALS;
  const copingMaterialOptions = load.data.options?.copingMaterials?.length
    ? load.data.options.copingMaterials
    : MATERIALS;
  const toggleMaterial = (group, value) =>
    setSummary((p) => ({
      ...p,
      [group]: p[group].includes(value)
        ? p[group].filter((m) => m !== value)
        : [...p[group], value],
    }));
  const visibleBuildingRows = (() => {
    const rows = BUILDING_ROWS.filter(
      ([, key]) => load.data.present?.[key] !== false
    ).map(([label, key, wide]) => [label, key, wide]);
    let runStart = null;
    for (let i = 0; i <= rows.length; i++) {
      const isNarrow = i < rows.length && !rows[i][2];
      if (isNarrow && runStart === null) runStart = i;
      if (!isNarrow && runStart !== null) {
        if ((i - runStart) % 2 === 1) rows[i - 1][2] = true;
        runStart = null;
      }
    }
    return rows;
  })();
  // Always show the spelled-out wording, even when ClickUp still stores the
  // "SWARMP" shorthand. The submit route matches on aliases.
  const scoreOptions = SCORES;

  return (
    <>
      <div className="hazard-tape" />
      {!online && <div className="offline-bar">Offline · work is saved, uploads will retry</div>}

      <main className="shell">
        <div className="topbar">
          <span className="mark">CC</span>
          <span className="topbar-title">{building.address || load.data.taskName}</span>
          <span className="topbar-count">{step + 1}/{STEPS.length}</span>
        </div>

        <nav className="rail" aria-label="Inspection steps">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              className="rail-step"
              data-state={i === step ? "active" : i < step ? "done" : "todo"}
              onClick={() => setStep(i)}
              type="button"
            >
              {s.tab}
            </button>
          ))}
        </nav>

        <div className="page">
          {/* ---------------------------------------------------- BUILDING */}
          {current.id === "building" && (
            <>
              <p className="eyebrow">Step 1 · Dispatch</p>
              <h1 className="step-title">Confirm the building</h1>
              <p className="step-lede">
                Check this against what is in front of you. Wrong address means a wrong report.
              </p>

              <div className="data-grid">
                {visibleBuildingRows.map(([label, key, wide]) => (
                  <div className={`data-cell${wide ? " wide" : ""}`} key={key}>
                    <div className="data-key">{label}</div>
                    <div className={`data-val${building[key] ? "" : " empty"}`}>
                      {building[key] || "not set"}
                    </div>
                  </div>
                ))}
              </div>

              <div className="notice">
                <div>
                  <strong>Before you go up</strong>
                  Roof access clear, PPE on, and someone knows you are on the roof.
                </div>
              </div>

              {load.data.missingFields?.length > 0 && (
                <div className="notice warn">
                  <div>
                    <strong>{load.data.missingFields.length} field(s) missing on this list</strong>
                    {load.data.missingFields.join(", ")}. Anything missing will not be written back.
                  </div>
                </div>
              )}
            </>
          )}

          {/* --------------------------------------------------- MATERIALS */}
          {current.id === "materials" && (
            <>
              <p className="eyebrow">Step 2 · Construction</p>
              <h1 className="step-title">Materials</h1>
              <p className="step-lede">
                Tag every material you can see. Wall and coping are recorded separately.
              </p>

              <div className="field">
                <span className="label">Parapet wall</span>
                <p className="hint">Select all that apply.</p>
                <div className="chips">
                  {wallMaterialOptions.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="chip"
                      aria-pressed={summary.wallMaterials.includes(m)}
                      onClick={() => toggleMaterial("wallMaterials", m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="label">Coping</span>
                <p className="hint">
                  The cap on top of the wall. Often not the same material as the wall.
                </p>
                <div className="chips">
                  {copingMaterialOptions.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="chip"
                      aria-pressed={summary.copingMaterials.includes(m)}
                      onClick={() => toggleMaterial("copingMaterials", m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label className="label" htmlFor="repairs">Past repairs observed</label>
                <p className="hint">Anything visible, no time limit. Patching, repointing, tie-backs.</p>
                <textarea
                  id="repairs"
                  value={summary.pastRepairs}
                  placeholder="e.g. repointed mortar joints along the west return, recent"
                  onChange={(e) => setSummary((p) => ({ ...p, pastRepairs: e.target.value }))}
                />
              </div>
            </>
          )}

          {/* -------------------------------------------------- ELEVATIONS */}
          {DIRECTIONS.map(({ key, letter, label }) =>
            current.id === key ? (
              <div key={key}>
                <div className="watermark" aria-hidden="true">{letter}</div>
                <p className="eyebrow">Step {step + 1} · Elevation</p>
                <h1 className="step-title">{label} parapet</h1>
                <p className="step-lede">Walk the full run before you choose.</p>

                <div className="choices">
                  {conditionOptions.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      className="choice"
                      data-tone={c.tone}
                      aria-pressed={elevations[key].condition === c.name}
                      onClick={() =>
                        setElevations((p) => ({
                          ...p,
                          [key]: {
                            ...p[key],
                            condition: c.name,
                            defects: c.name === "Some Defects Present" ? p[key].defects : [],
                          },
                        }))
                      }
                    >
                      <span className="choice-dot" />
                      <span className="choice-body">
                        <span className="choice-name">{c.name}</span>
                        <span className="choice-sub">{c.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {elevations[key].condition === "Some Defects Present" && (
                  <div className="field">
                    <span className="label">Defects present</span>
                    <div className="chips">
                      {DEFECTS.map((d) => {
                        const on = elevations[key].defects.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            className="chip"
                            aria-pressed={on}
                            onClick={() =>
                              setElevations((p) => ({
                                ...p,
                                [key]: {
                                  ...p[key],
                                  defects: on
                                    ? p[key].defects.filter((x) => x !== d)
                                    : [...p[key].defects, d],
                                },
                              }))
                            }
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="field">
                  <label className="label" htmlFor={`notes-${key}`}>Notes</label>
                  <textarea
                    id={`notes-${key}`}
                    value={elevations[key].notes}
                    placeholder={`What you saw on the ${label.toLowerCase()} elevation`}
                    onChange={(e) =>
                      setElevations((p) => ({ ...p, [key]: { ...p[key], notes: e.target.value } }))
                    }
                  />
                </div>

                <div className="field">
                  <span className="label">{label} elevation photos</span>
                  <PhotoCapture
                    label="Capture photo"
                    items={elevations[key].photos}
                    onAdd={(files) => addElevationPhotos(key, files)}
                    onRemove={(id) => removeElevationPhoto(key, id)}
                  />
                </div>
              </div>
            ) : null
          )}

          {/* ----------------------------------------------------- SUMMARY */}
          {current.id === "summary" && (
            <>
              <p className="eyebrow">Step 7 · Observation</p>
              <h1 className="step-title">Overall score</h1>
              <p className="step-lede">One score for the whole parapet. This drives the filing.</p>

              <div className="choices">
                {scoreOptions.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    className="choice"
                    data-tone={s.tone}
                    aria-pressed={summary.score === s.name}
                    onClick={() => setSummary((p) => ({ ...p, score: s.name }))}
                  >
                    <span className="choice-dot" />
                    <span className="choice-body">
                      <span className="choice-name">{s.name}</span>
                      <span className="choice-sub">{s.sub}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="field">
                <span className="label">360 video</span>
                <p className="hint">One continuous pass around the full parapet.</p>
                <PhotoCapture
                  label="Record / attach video"
                  accept="video/*"
                  multiple={false}
                  items={summary.video}
                  onAdd={(files) =>
                    setSummary((p) => ({ ...p, video: [...p.video, ...makeItems(files)] }))
                  }
                  onRemove={(id) =>
                    setSummary((p) => ({ ...p, video: p.video.filter((v) => v.id !== id) }))
                  }
                />
              </div>

              <div className="field">
                <span className="label">Review</span>
                <div className="review">
                  <div className="review-row">
                    <span className="review-key">Wall</span>
                    <span className={`review-val${summary.wallMaterials.length ? "" : " miss"}`}>
                      {summary.wallMaterials.join(", ") || "not set"}
                    </span>
                  </div>
                  <div className="review-row">
                    <span className="review-key">Coping</span>
                    <span className={`review-val${summary.copingMaterials.length ? "" : " miss"}`}>
                      {summary.copingMaterials.join(", ") || "not set"}
                    </span>
                  </div>
                  {DIRECTIONS.map(({ key, label }) => (
                    <div className="review-row" key={key}>
                      <span className="review-key">{label}</span>
                      <span className={`review-val${elevations[key].condition ? "" : " miss"}`}>
                        {elevations[key].condition || "not set"}
                        {elevations[key].defects.length
                          ? ` — ${elevations[key].defects.join(", ")}`
                          : ""}
                        {elevations[key].photos.length
                          ? ` · ${elevations[key].photos.length} photo(s)`
                          : " · no photos"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ----------------------------------------------------- SIGN OFF */}
          {current.id === "signoff" && (
            <>
              <p className="eyebrow">Step 8 · Sign off</p>
              <h1 className="step-title">Inspector sign-off</h1>
              <p className="step-lede">
                Submitting writes every field to the task and moves the phase to Inspected.
              </p>

              <div className="field">
                <label className="label" htmlFor="insp-name">Inspector name</label>
                <input
                  id="insp-name"
                  type="text"
                  value={signOff.inspectorName}
                  onChange={(e) => setSignOff((p) => ({ ...p, inspectorName: e.target.value }))}
                  placeholder="Full name"
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="insp-firm">Firm</label>
                <input
                  id="insp-firm"
                  type="text"
                  value={signOff.inspectorFirm}
                  onChange={(e) => setSignOff((p) => ({ ...p, inspectorFirm: e.target.value }))}
                />
              </div>

              <div className="field">
                <span className="label">Signature</span>
                <SignaturePad onChange={(sig) => setSignOff((p) => ({ ...p, signature: sig }))} />
              </div>

              {pending.length > 0 && (
                <div className="notice warn">
                  <div>
                    <strong>{pending.length} file(s) still queued</strong>
                    They will upload as part of submitting.
                  </div>
                </div>
              )}

              {submit.error && (
                <div className="notice bad">
                  <div>
                    <strong>Submit failed</strong>
                    {submit.error}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="footer">
          <div className="footer-inner">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || submit.state === "working"}
            >
              Back
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                disabled={!canAdvance}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={doSubmit}
                disabled={submit.state === "working" || !signOff.inspectorName || !signOff.signature}
              >
                {submit.state === "working" ? "Submitting…" : "Submit report"}
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
