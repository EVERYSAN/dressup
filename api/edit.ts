import type { VercelRequest, VercelResponse } from '@vercel/node';

function parseDataURL(d: string): { mime: string; base64: string } {
  const m = d.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL');
  return { mime: m[1], base64: m[2] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY / GOOGLE_GENAI_API_KEY is not set' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { prompt, image1, image2, model } = body;
    if (!prompt || !image1) return res.status(400).json({ error: 'prompt と image1 は必須です' });

    const modelName = model || 'gemini-2.5-flash-image-preview';
    const parts: any[] = [{ text: String(prompt) }];

    const i1 = parseDataURL(image1);
    parts.push({ inlineData: { mimeType: i1.mime, data: i1.base64 } });

    if (image2) {
      const i2 = parseDataURL(image2);
      parts.push({ inlineData: { mimeType: i2.mime, data: i2.base64 } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }) });

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(upstream.status).send(text);
  } catch (e: any) {
    return res.status(500).json({ error: 'FUNCTION_INVOCATION_FAILED', detail: e?.message || String(e) });
  }
}
console.log("[api/edit] model=", model || "gemini-2.5-flash-image-preview",
            "has image1=", !!image1, "has image2=", !!image2);
