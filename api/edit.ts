// /api/edit.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * dataURL から { mime, base64 } を取り出す
 */
function parseDataURL(d: string): { mime: string; base64: string } {
  const m = d.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL');
  return { mime: m[1], base64: m[2] };
}

/**
 * Gemini(Nano Banana = 画像モデル) に “画像編集” 形式で問い合わせる。
 * 画像は inlineData で送る： contents = [ {text}, {inlineData(image1)}, {inlineData(image2?)} ]
 * レスポンスは candidates[0].content.parts[].inlineData に base64 で返ってくる。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY / GOOGLE_GENAI_API_KEY が未設定です' });
  }

  try {
    // Vercel は JSON を既にパースしていることもあるので両対応
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const prompt: string | undefined = body?.prompt;
    const image1: string | undefined = body?.image1; // dataURL (必須)
    const image2: string | undefined = body?.image2; // dataURL (任意)
    const modelFromClient: string | undefined = body?.model;

    if (!prompt || !image1) {
      return res.status(400).json({ error: 'prompt と image1 は必須です' });
    }

    // Nano Banana 系の画像モデル名（環境に応じて Preview/非Preview が異なることがあります）
    const model = modelFromClient || 'gemini-2.5-flash-image-preview';

    // contents の parts を組み立て
    const parts: any[] = [{ text: String(prompt) }];

    // 1枚目（必須）
    const img1 = parseDataURL(image1);
    parts.push({
      inlineData: { mimeType: img1.mime, data: img1.base64 },
    });

    // 2枚目（任意）
    if (image2) {
      const img2 = parseDataURL(image2);
      parts.push({
        inlineData: { mimeType: img2.mime, data: img2.base64 },
      });
    }

    // REST 経由で Gemini に投げる（画像モデルの generateContent）
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Gemini の画像生成/編集は contents: [{ parts: [...] }] の形
      body: JSON.stringify({
        contents: [{ parts }],
        // 必要なら generationConfig / safetySettings を追加
      }),
    });

    const text = await upstream.text();

    // そのまま返す（フロントは candidates[0].content.parts[].inlineData を抽出）
    res.setHeader('Content-Type', 'application/json');
    return res.status(upstream.status).send(text);
  } catch (e: any) {
    console.error('[api/edit] error', e?.message);
    return res.status(500).json({
      error: 'FUNCTION_INVOCATION_FAILED',
      detail: e?.message || String(e),
    });
  }
}
