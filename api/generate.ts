// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

/** dataURL -> mime 推定 */
function pickMime(dataUrl: string): string {
  return dataUrl?.match?.(/^data:([^;]+);base64,/)?.[1] || 'image/png';
}
/** dataURL -> base64（ヘッダ剥がし） */
function stripBase64(dataUrl: string): string {
  return dataUrl?.replace?.(/^data:[^;]+;base64,/, '') || '';
}
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
    console.error('[api/generate] missing API key');
    return res.status(500).json({ error: 'GEMINI_API_KEY / GOOGLE_GENAI_API_KEY is not set' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { prompt } = body as { prompt: string; model?: string };
    const referenceImages: string[] | undefined = Array.isArray(body?.referenceImages) ? body.referenceImages : undefined;

    if (!prompt) {
      console.warn('[api/generate] 400 prompt missing');
      return res.status(400).json({ error: 'prompt は必須です' });
    }

    // ログ①（受信内容のサマリ）
    console.log('[api/generate] request',
      { promptLen: String(prompt).length, refCount: referenceImages?.length || 0 }
    );

    // モデルは画像対応のものに固定
    const modelName = 'gemini-2.5-flash-image-preview';

    // “画像だけ返す”誘導を付与
    const enforcedPrompt =
      `${String(prompt).trim()}\n\nReturn an image only. Do not include any text in the response.`;

    // parts 構築
    const parts: any[] = [{ text: enforcedPrompt }];
    if (referenceImages?.length) {
      for (const durl of referenceImages) {
        const mime = pickMime(durl);
        const b64 = stripBase64(durl);
        parts.push({ inlineData: { mimeType: mime, data: b64 } });
      }
    }

    // ログ②（送信前サイズ）
    const totalBytes =
      (parts?.slice(1) || [])
        .map((p: any) => approxBytesFromBase64(p?.inlineData?.data || ''))
        .reduce((a: number, b: number) => a + b, 0);
    console.log('[api/generate] model=', modelName, 'totalImageBytes=', totalBytes);

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
    console.log('[api/generate] upstream status=', upstream.status,
      'hasCandidates=', !!json?.candidates?.length,
      'partTypes=', json?.candidates?.[0]?.content?.parts?.map((p: any) => Object.keys(p)[0])
    );

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(upstream.status).send(text);
  } catch (e: any) {
    console.error('[api/generate] error', e?.message);
    return res.status(500).json({ error: 'FUNCTION_INVOCATION_FAILED', detail: e?.message || String(e) });
  }
}
