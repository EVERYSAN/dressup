import type { VercelRequest, VercelResponse } from '@vercel/node';

type EditBody = {
  prompt: string;                 // 例: "1枚目の服を2枚目の服に置き換えてください"
  image1: string;                 // dataURL or pure base64
  image2?: string;                // 追加や差し替え用（任意）
  mime1?: string;                 // 省略時は image/png
  mime2?: string;                 // 省略時は image/png
  model?: string;                 // 省略時 gemini-2.0-flash-exp
};

const stripDataUrl = (s: string) => s.replace(/^data:[^;]+;base64,/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APIキー未設定' });

  try {
    const body: EditBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      prompt,
      image1,
      image2,
      mime1 = 'image/png',
      mime2 = 'image/png',
      model = 'gemini-2.0-flash-exp'
    } = body || {};

    if (!prompt || !image1) {
      return res.status(400).json({ error: 'prompt と image1 は必須です' });
    }

    const parts: any[] = [{ text: prompt }];
    parts.push({ inlineData: { mimeType: mime1, data: stripDataUrl(image1) } });
    if (image2) parts.push({ inlineData: { mimeType: mime2, data: stripDataUrl(image2) } });

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
      encodeURIComponent(apiKey);

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });

    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e: any) {
    res.status(500).json({ error: 'proxy error', detail: e?.message });
  }
}
