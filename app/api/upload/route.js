import { NextResponse } from "next/server";
import { CLICKUP_API, getToken } from "@/lib/clickup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Streams one captured photo / video straight through to the task's attachments.
export async function POST(request) {
  try {
    const token = getToken();
    const incoming = await request.formData();
    const taskId = incoming.get("taskId");
    const file = incoming.get("file");
    const filename = incoming.get("filename") || (file && file.name) || "capture.jpg";

    if (!taskId) return NextResponse.json({ error: "Missing taskId." }, { status: 400 });
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Missing file." }, { status: 400 });
    }

    const outgoing = new FormData();
    outgoing.append("attachment", file, String(filename));
    outgoing.append("filename", String(filename));

    const res = await fetch(
      `${CLICKUP_API}/task/${encodeURIComponent(String(taskId))}/attachment`,
      {
        method: "POST",
        headers: { Authorization: token },
        body: outgoing,
      }
    );

    const raw = await res.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = { raw };
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: (body && (body.err || body.error)) || `Upload failed (${res.status}).` },
        { status: res.status }
      );
    }

    return NextResponse.json({
      id: body?.id,
      url: body?.url,
      title: body?.title || filename,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Upload failed." },
      { status: 500 }
    );
  }
}
