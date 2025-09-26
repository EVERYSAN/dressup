// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APIキー未設定' });

  try {
    const payload = req.body; // { contents: [...] } か { prompt, base64Image1, ... }

    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' +
      encodeURIComponent(apiKey);

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    // そのまま転送（JSON/エラー可視化）
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e: any) {
    res.status(500).json({ error: 'proxy error', detail: e?.message });
  }
}
