// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 必要な環境変数（Vercel）
 * - GEMINI_API_KEY               : 必須（AI Studio API Key）
 * - GEMINI_IMAGE_MODEL (任意)    : 例) gemini-2.5-flash-image-preview（未設定ならこれを使用）
 *
 * 備考:
 * - Images/Imagen 用の edit/generate エンドポイントは使用しません。
 *   正しいのは Generative Language API の ":generateContent" です。
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const MODEL =
  process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// "data:image/png;base64,...." を受けても素の base64 に変換 & MIME を取り出す
function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!m) return { mime: 'image/png', base64: dataUrl };
  return { mime: m[1], base64: m[2] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS（必要に応じて調整）
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server error', detail: 'Missing GEMINI_API_KEY' });
    }

    const { prompt, image1, image2, temperature } = req.body || {};
    if (!prompt || !image1) {
      return res.status(400).json({ error: 'Bad Request', detail: 'prompt and image1 are required' });
    }

    const p1 = splitDataUrl(image1);
    const p2 = image2 ? splitDataUrl(image2) : null;

    // テキストではなく「画像として返す」ことを明示（REST では response_mime_type は使えないため、指示で誘導）
    const systemText =
      'You are an image editing model. Always return the result as an IMAGE (inlineData). ' +
      'Do not include any textual explanation in the response parts.';

    // Generative Language API / generateContent のボディ
    const body = {
      systemInstruction: {
        role: 'system',
        parts: [{ text: systemText }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: p1.mime, data: p1.base64 } },
            ...(p2 ? [{ inline_data: { mime_type: p2.mime, data: p2.base64 } }] : []),
          ],
        },
      ],
      generationConfig: {
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        // NOTE: REST では response_mime_type はテキスト系のみ受理のため送らない
      },
    };

    // タイムアウト（Vercel 60s 上限対策）
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 55_000);

    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).catch((e) => {
      throw new Error(`Fetch failed: ${String(e)}`);
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return res.status(500).json({ error: 'Images API error', detail: text });
    }

    const json = await resp.json();

    // 画像は candidates[0].content.parts[*].inlineData (or inline_data) に入る
    const candidates = json?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];

    let imageBase64: string | null = null;
    let imageMime: string | null = null;
    const textOut: string[] = [];

    for (const part of parts) {
      // camelCase
      if (part?.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        imageMime = part.inlineData.mimeType || 'image/png';
        break;
      }
      // snake_case（環境差吸収の保険）
      if (part?.inline_data?.data) {
        imageBase64 = part.inline_data.data;
        imageMime = part.inline_data.mime_type || 'image/png';
        break;
      }
      if (part?.text) textOut.push(part.text);
    }

    if (!imageBase64) {
      return res.status(500).json({
        error: 'No image in response',
        text: textOut.join('\n'),
      });
    }

    return res.status(200).json({
      image: { data: imageBase64, mimeType: imageMime },
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
