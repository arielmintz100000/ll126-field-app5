// GET /api/health
// A dependency-free check that answers two questions at once:
//   1. Did the serverless functions deploy at all? (if you get JSON, yes)
//   2. Is the ClickUp token set and accepted?
// Open this in a browser after deploying. If you see Vercel's
// "The page could not be found" instead of JSON, the api/ folder is not
// deployed -- see the Troubleshooting section of the README.

export default async function handler(req, res) {
  const token = process.env.CLICKUP_API_TOKEN || '';

  const out = {
    ok: true,
    functionsDeployed: true,
    tokenPresent: Boolean(token),
    tokenLooksValid: null,
    clickUpReachable: null,
    node: process.version,
    checkedAt: new Date().toISOString(),
  };

  if (!token) {
    out.ok = false;
    out.hint =
      'CLICKUP_API_TOKEN is not set. Vercel -> Settings -> Environment Variables, add it, then redeploy.';
    res.status(200).json(out);
    return;
  }

  try {
    const r = await fetch('https://api.clickup.com/api/v2/user', {
      headers: { Authorization: token },
    });
    out.clickUpReachable = true;
    out.tokenLooksValid = r.ok;
    if (r.ok) {
      const d = await r.json();
      out.authenticatedAs = d?.user?.username || d?.user?.email || 'unknown';
      out.hint = 'All good. The app should load building data.';
    } else {
      out.ok = false;
      out.hint = `ClickUp rejected the token (HTTP ${r.status}). Regenerate it in ClickUp -> Settings -> Apps and update the Vercel variable.`;
    }
  } catch (err) {
    out.ok = false;
    out.clickUpReachable = false;
    out.hint = `Could not reach ClickUp: ${err.message}`;
  }

  res.status(200).json(out);
}
