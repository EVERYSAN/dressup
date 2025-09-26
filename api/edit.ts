import type { VercelRequest, VercelResponse } from '@vercel/node';

// dataURL でも純 base64 でもOKにする
const stripDataUrl = (s?: string) =>
  (s ?? '').replace(/^data:[^;]+;base64,/, '');

type RawBody = any;

/**
 * 受け取った body を正規化する。
 * 1) すでに contents がある → そのまま Gemini にプロキシ
 * 2) prompt + image1(+image2) など → parts を構築
 */
function normalizeToGeminiPayload(raw: RawBody) {
  // パス1: すでに Gemini 形式（contents）がある → そのまま返す
  if (raw && raw.contents) {
    const model = raw.model || 'gemini-2.0-flash-exp';
    return { passthrough: true as const, model, payload: raw };
  }

  // パス2: フィールド名のゆらぎを吸収
  const prompt: string =
    raw?.prompt ??
    raw?.instruction ??
    raw?.text ??
    '';

  // 受け取りうる別名を総当り
  const image1Raw: string | undefined =
    raw?.image1 ??
    raw?.base64Image1 ??
    raw?.img1 ??
    raw?.source ??
    raw?.image ??
    undefined;

  const image2Raw: string | undefined =
    raw?.image2 ??
    raw?.base64Image2 ??
    raw?.img2 ??
    raw?.target ??
    undefined;

  const mime1: string = raw?.mime1 || 'image/png';
  const mime2: string = raw?.mime2 || 'image/png';
  const model: string = raw?.model || 'gemini-2.0-flash-exp';

  return {
    passthrough: false as const,
    model,
    prompt,
    image1Raw,
    image2Raw,
    mime1,
    mime2,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APIキー未設定' });

  try {
    // Vercel Node Functions は application/json なら自動でパース済み
    const raw: RawBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const norm = normalizeToGeminiPayload(raw);

    let model: string;
    let bodyToSend: any;

    if (norm.passthrough) {
      // すでに Gemini 形式 → そのまま送る
      model = norm.model;
      bodyToSend = norm.payload;
    } else {
      // prompt / image1 → parts を構築
      const { prompt, image1Raw, image2Raw, mime1, mime2 } = norm;

      if (!prompt || !image1Raw) {
        // 何が届いているかヒントを返す（デバッグを楽に）
        return res.status(400).json({
          error: 'prompt と image1 は必須です',
          gotKeys: Object.keys(raw || {}),
          hint: 'body は { prompt, image1, image2? } もしくは { model, contents } 形式にしてください',
        });
      }

      const parts: any[] = [
        { text: String(prompt) },
        { inlineData: { mimeType: mime1, data: stripDataUrl(String(image1Raw)) } },
      ];
      if (image2Raw) {
        parts.push({ inlineData: { mimeType: mime2, data: stripDataUrl(String(image2Raw)) } });
      }

      model = norm.model;
      bodyToSend = { contents: [{ parts }] };
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
      encodeURIComponent(apiKey);

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyToSend),
    });

    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e: any) {
    res.status(500).json({ error: 'proxy error', detail: e?.message });
  }
}
