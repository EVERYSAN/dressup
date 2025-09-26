// api/edit.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

/** dataURL -> { mime, base64 } */
function parseDataURL(d: string): { mime: string; base64: string } {
  const m = d?.match?.(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL');
  return { mime: m[1], base64: m[2] };
}

/** 簡易バイト数推定（ログ用） */
function approxBytesFromBase64(b64: string) {
  return Math.floor((b64?.length || 0) * 3 / 4);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    console.error('[api/edit] missing API key');
    return res.status(500).json({ error: 'GEMINI_API_KEY / GOOGLE_GENAI_API_KEY is not set' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let { prompt, image1, image2 } = body as {
      prompt: string;
      image1: string;  // dataURL
      image2?: string; // dataURL
      model?: string;  // ← 無視（下で固定）
    };

    if (!prompt || !image1) {
      console.warn('[api/edit] 400 prompt or image1 missing');
      return res.status(400).json({ error: 'prompt と image1 は必須です' });
    }

    // ログ①（受信内容のサマリ）
    console.log('[api/edit] request',
      { hasImage1: !!image1, hasImage2: !!image2, promptLen: String(prompt).length }
    );

    // モデルは画像対応のものに固定
    const modelName = 'gemini-2.5-flash-image-preview';

    // “画像だけ返す”誘導を付与（テキスト返答抑止）
    const enforcedPrompt =
      `${String(prompt).trim()}\n\nReturn an image only. Do not include any text in the response.`;

    // parts 構築
    const parts: any[] = [{ text: enforcedPrompt }];

    // image1（必須）
    const i1 = parseDataURL(image1);
    parts.push({ inlineData: { mimeType: i1.mime, data: i1.base64 } });

    // image2（任意・同一画像なら除外）
    if (image2) {
      try {
        const i2 = parseDataURL(image2);
        if (i2.base64 !== i1.base64) {
          parts.push({ inlineData: { mimeType: i2.mime, data: i2.base64 } });
        } else {
          console.log('[api/edit] skipped image2: same as image1');
          image2 = undefined;
        }
      } catch (e) {
        console.warn('[api/edit] image2 parse failed:', (e as Error)?.message);
        image2 = undefined;
      }
    }

    // ログ②（送信前サイズ）
    console.log('[api/edit] model=', modelName,
      'bytes(image1)=', approxBytesFromBase64(i1.base64),
      'bytes(image2)=', image2 ? approxBytesFromBase64(parseDataURL(image2).base64) : 0
    );

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });

    // ログ③（上流レスポンスの要点だけ）
    let json: any = null;
    try {
      json = await upstream.clone().json();
    } catch {
      /* ignore parse error */
    }
    console.log('[api/edit] upstream status=', upstream.status,
      'hasCandidates=', !!json?.candidates?.length,
      'partTypes=', json?.candidates?.[0]?.content?.parts?.map((p: any) => Object.keys(p)[0])
    );

    // 返却は“そのまま”
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(upstream.status).send(text);
  } catch (e: any) {
    console.error('[api/edit] error', e?.message);
    return res.status(500).json({ error: 'FUNCTION_INVOCATION_FAILED', detail: e?.message || String(e) });
  }
}
