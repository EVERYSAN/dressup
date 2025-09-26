import type { VercelRequest, VercelResponse } from '@vercel/node';

function pickMime(dataUrl: string): string {
  return dataUrl.match(/^data:([^;]+);base64,/)?.[1] || 'image/png';
}
function stripBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY / GOOGLE_GENAI_API_KEY is not set' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { prompt, referenceImages, model } = body;
    if (!prompt) return res.status(400).json({ error: 'prompt は必須です' });

    const modelName = model || 'gemini-2.5-flash-image-preview';
    const parts: any[] = [{ text: String(prompt) }];

    if (Array.isArray(referenceImages)) {
      for (const durl of referenceImages) {
        parts.push({ inlineData: { mimeType: pickMime(durl), data: stripBase64(durl) } });
      }
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
console.log("[api/generate] model=", model || "gemini-2.5-flash-image-preview",
            "parts=", (Array.isArray(referenceImages) ? referenceImages.length : 0) + 1);
