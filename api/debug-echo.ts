// api/debug-echo.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])
  );

  // Bodyを安全に拾う（JSON/その他）
  let rawBody: any = req.body ?? null;
  if (typeof rawBody === 'string') {
    try { rawBody = JSON.parse(rawBody); } catch {}
  }

  return res.status(200).json({
    method: req.method,
    contentType: headers['content-type'] || null,
    gotKeys: rawBody && typeof rawBody === 'object' ? Object.keys(rawBody) : null,
    sampleBody: rawBody && typeof rawBody === 'object'
      ? Object.fromEntries(Object.entries(rawBody).slice(0, 5))
      : (typeof rawBody === 'string' ? rawBody.slice(0, 200) : null),
  });
}
