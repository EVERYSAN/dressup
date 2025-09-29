// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 必須環境変数
 * - GEMINI_API_KEY
 * 任意
 * - GEMINI_IMAGE_MODEL（例: "gemini-2.5-flash-image-preview"）
 *
 * ポイント:
 * - まず ListModels でモデル存在を検証してから generateContent を呼ぶ
 * - v1beta→v1 の順にフォールバック
 * - inline_data で画像を送り、inlineData で画像を受け取る
 */

const API_KEY = process.env.GEMINI_API_KEY!;
const ENV_MODEL = (process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview').trim();

// よくある打ち間違いの自動補正
function normalizeModel(m: string) {
  if (m === 'gemini-2.5-flash-image') return 'gemini-2.5-flash-image-preview';
  return m;
}

// dataURL -> base64 + mime
function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!m) return { mime: 'image/png', base64: dataUrl };
  return { mime: m[1], base64: m[2] };
}

// v1beta / v1 の順で ListModels を試し、使えるモデル名を返す
async function resolveUsableModel(rawModel: string): Promise<{ modelId: string; apiBase: 'v1beta'|'v1' }> {
  const target = normalizeModel(rawModel);

  for (const apiBase of ['v1beta', 'v1'] as const) {
    const listUrl = `https://generativelanguage.googleapis.com/${apiBase}/models?key=${encodeURIComponent(API_KEY)}`;
    const resp = await fetch(listUrl, { headers: { 'x-goog-api-key': API_KEY } });
    if (!resp.ok) continue;

    const json = await resp.json().catch(() => ({}));
    const models: any[] = json?.models || [];

    // List の "name" は "models/<id>" 形式
    const found = models.find((m) => {
      const name: string = m?.name || '';
      return name.endsWith(`/models/${target}`) || name === `models/${target}`;
    }) || models.find((m) => (m?.name || '').includes(target));

    if (found) {
      return { modelId: target, apiBase };
    }
  }

  // どちらの API でも見つからなかった → 詳細を返すため v1beta の一覧を拾って付ける
  //（ユーザーのキーで使えるモデル名を可視化）
  const fallbackList = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(API_KEY)}`, {
    headers: { 'x-goog-api-key': API_KEY },
  }).then(r => r.ok ? r.json() : Promise.resolve({})).catch(() => ({}));

  const available = (fallbackList?.models || []).map((m: any) => m?.name).filter(Boolean);

  throw new Error(
    `Model "${target}" not found with your key. Available (sample) = ` +
    (available.slice(0, 10).join(', ') || '[]')
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!API_KEY) {
      return res.status(500).json({ error: 'Server error', detail: 'Missing GEMINI_API_KEY' });
    }

    const { prompt, image1, image2, temperature } = req.body || {};
    if (!prompt || !image1) {
      return res.status(400).json({ error: 'Bad Request', detail: 'prompt and image1 are required' });
    }

    // 1) 使えるモデル名 & API バージョンを確定
    const { modelId, apiBase } = await resolveUsableModel(ENV_MODEL);
    const ENDPOINT = `https://generativelanguage.googleapis.com/${apiBase}/models/${modelId}:generateContent`;

    const p1 = splitDataUrl(image1);
    const p2 = image2 ? splitDataUrl(image2) : null;

    // 画像で返すことを強めに指示（REST は response_mime_type が使えないため）
    const systemText =
      'You are an image editing model. Always return the result as an IMAGE (inlineData). ' +
      'Do not include any textual explanation in the response parts.';

    const body = {
      systemInstruction: { role: 'system', parts: [{ text: systemText }] },
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: p1.mime, data: p1.base64 } },
          ...(p2 ? [{ inline_data: { mime_type: p2.mime, data: p2.base64 } }] : []),
        ],
      }],
      generationConfig: {
        temperature: typeof temperature === 'number' ? temperature : 0.7,
      },
    };

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 55_000);

    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-goog-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).catch((e) => { throw new Error(`Fetch failed: ${String(e)}`); });

    clearTimeout(to);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return res.status(500).json({ error: 'Images API error', detail });
    }

    const json = await resp.json();

    // candidates[0].content.parts から inlineData を拾う（snake/camel 両対応）
    const candidates = json?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];

    let imageBase64: string | null = null;
    let imageMime: string | null = null;
    const textOut: string[] = [];

    for (const part of parts) {
      if (part?.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        imageMime = part.inlineData.mimeType || 'image/png';
        break;
      }
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

    return res.status(200).json({ image: { data: imageBase64, mimeType: imageMime } });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
