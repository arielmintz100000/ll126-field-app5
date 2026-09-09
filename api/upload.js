// POST /api/upload
// Body: { taskId, filename, contentType, dataBase64 }
// Uploads one file as a ClickUp task attachment and returns its id + url.
// Photos are compressed in the browser before they get here, which keeps every
// request comfortably under Vercel's 4.5 MB request ceiling.

import { cu, sendError, HttpError } from './_clickup.js';

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
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    const { taskId, filename, contentType, dataBase64 } = await readJson(req);

    if (!taskId) throw new HttpError(400, 'Missing taskId.');
    if (!dataBase64) throw new HttpError(400, 'Missing file data.');

    const buffer = Buffer.from(String(dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) throw new HttpError(400, 'File data was empty.');

    const form = new FormData();
    form.append(
      'attachment',
      new Blob([buffer], { type: contentType || 'application/octet-stream' }),
      filename || 'upload.jpg'
    );

    const out = await cu(`/task/${encodeURIComponent(taskId)}/attachment`, {
      method: 'POST',
      body: form,
    });

    res.status(200).json({ ok: true, id: out.id, url: out.url || out.url_w_query || null });
  } catch (err) {
    sendError(res, err);
  }
}
