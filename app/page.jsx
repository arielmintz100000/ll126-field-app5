import Link from "next/link";

export const dynamic = "force-dynamic";

// The root route. Its whole job is to exist: a deploy without a page here is
// what produces Vercel's 404 NOT_FOUND on the bare domain.
export default function Home() {
  const configured = Boolean(process.env.CLICKUP_API_TOKEN);

  return (
    <>
      <div className="hazard-tape" />
      <main className="shell">
        <div className="topbar">
          <span className="mark">CC</span>
          <span className="topbar-title">LL126 Field Inspector</span>
        </div>

        <div className="page">
          <p className="eyebrow">Capitol Compliance</p>
          <h1 className="step-title">Deployment live</h1>
          <p className="step-lede">
            This app is opened from a dispatch link, not from here. Each link carries the
            project task it belongs to.
          </p>

          <div className={configured ? "notice ok" : "notice bad"}>
            <div>
              <strong>
                {configured
                  ? "ClickUp API token detected"
                  : "ClickUp API token missing"}
              </strong>
              {configured
                ? "The app can read and write project tasks."
                : "Add CLICKUP_API_TOKEN in Vercel > Settings > Environment Variables, then redeploy."}
            </div>
          </div>

          <div className="field">
            <span className="label">Dispatch link format</span>
            <div className="code">https://YOUR-DOMAIN.vercel.app/inspect?taskId=86ey99gg0</div>
            <p className="hint">
              Paste this into the dispatch automation on the Projects list and let ClickUp
              fill in the task id.
            </p>
          </div>

          <div className="field">
            <span className="label">Try it</span>
            <p className="hint">
              Open <Link href="/inspect">/inspect</Link> without a task id to see the
              wizard&apos;s error handling, or append a real task id to load live building data.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
