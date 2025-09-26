import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const url = String(req.query.url || '');
    if (!url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: 'invalid url' });
    }
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({ error: `upstream ${r.status}` });
    }
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    const base64 = buf.toString('base64');
    const dataUrl = `data:${ct};base64,${base64}`;
    return res.status(200).json({ dataUrl, mime: ct });
  } catch (e: any) {
    return res.status(500).json({ error: 'proxy error', detail: e?.message });
  }
}
