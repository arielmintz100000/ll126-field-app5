import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <div className="hazard-tape" />
      <main className="center-state">
        <p className="eyebrow">404</p>
        <h1 className="step-title">No page here</h1>
        <p className="step-lede">
          Inspections open at <code>/inspect?taskId=...</code>. Check the dispatch link.
        </p>
        <Link href="/">Back to start</Link>
      </main>
    </>
  );
}
