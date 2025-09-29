// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// 必須: Vercel の環境変数にセット済みの API キー
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview';
// REST の正しいエンドポイント（Imagen ではなく generateContent）
const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// dataURL から base64 本体と mime を抽出
function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  // data:image/png;base64,xxxx
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!m) {
    // すでに base64 素の文字列の場合は既定 png 扱い
    return { mime: 'image/png', base64: dataUrl };
  }
  return { mime: m[1], base64: m[2] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS（必要なら）
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

    const {
      prompt,
      image1,      // dataURL か base64 文字列
      image2,      // 任意: 2 枚目（リファレンス等）
      temperature, // 任意
    } = req.body || {};

    if (!prompt || !image1) {
      return res.status(400).json({ error: 'Bad Request', detail: 'prompt and image1 are required' });
    }

    const p1 = splitDataUrl(image1);
    const p2 = image2 ? splitDataUrl(image2) : null;

    // モデルに「画像を返して」と明示するとテキストのみ応答になる確率が下がります
    const systemHint =
      'Return the result as an image. Do not include any textual explanation in the response.';

    // REST の generateContent ボディ
    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: `${systemHint}\n\n${prompt}` },
          { inline_data: { mime_type: p1.mime, data: p1.base64 } },
          ...(p2 ? [{ inline_data: { mime_type: p2.mime, data: p2.base64 } }] : []),
        ],
      }],
      // 応答を画像で期待するヒント（SDK と同等の効果）
      generationConfig: {
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        // これを指定すると画像パートを返しやすくなる
        response_mime_type: 'image/png',
      },
    };

    // 55 秒タイムアウト（Vercel の 60 秒上限対策）
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 55_000);

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
    clearTimeout(t);

    // 404, 403 等はそのまま詳細を返す
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: 'Images API error', detail: text });
    }

    const json = await resp.json();

    // 公式サンプル通り: candidates[0].content.parts[*] を見て inlineData を探す
    // https://ai.google.dev/gemini-api/docs/image-generation#rest
    const candidates = json?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];

    let imageBase64: string | null = null;
    let imageMime: string | null = null;
    let textOut: string[] = [];

    for (const part of parts) {
      if (part?.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        imageMime = part.inlineData.mimeType || 'image/png';
        break;
      }
      if (part?.inline_data?.data) {
        // 場合によっては snake_case で返る環境もあるため保険
        imageBase64 = part.inline_data.data;
        imageMime = part.inline_data.mime_type || 'image/png';
        break;
      }
      if (part?.text) textOut.push(part.text);
    }

    if (!imageBase64) {
      // 画像が返らなかったケースを可視化（あなたが見た “No image in response” がこれ）
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
