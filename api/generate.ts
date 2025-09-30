// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * 必須環境変数
 * - GEMINI_API_KEY
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * 任意
 * - GEMINI_IMAGE_MODEL（例: gemini-2.5-flash-image-preview）
 */

const API_KEY = process.env.GEMINI_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ENV_MODEL = (process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview').trim();

// よくある打ち間違いの補正
function normalizeModel(m: string) {
  if (m === 'gemini-2.5-flash-image') return 'gemini-2.5-flash-image-preview';
  return m;
}

// dataURL -> base64 + mime
function splitDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
  if (m) {
    const base64 = m[2]?.trim() || '';
    if (base64.length < 100) return null; // データが短すぎる＝無効扱い
    return { mime: m[1], base64 };
  }
  // 素の base64 が来るケース
  const base64 = dataUrl.trim();
  if (base64.length < 100) return null;
  return { mime: 'image/png', base64 };
}

// v1beta / v1 の順で ListModels を試し、使えるモデル名を確定
async function resolveUsableModel(rawModel: string): Promise<{ modelId: string; apiBase: 'v1beta' | 'v1' }> {
  const target = normalizeModel(rawModel);

  for (const apiBase of ['v1beta', 'v1'] as const) {
    const listUrl = `https://generativelanguage.googleapis.com/${apiBase}/models?key=${encodeURIComponent(API_KEY)}`;
    const resp = await fetch(listUrl, { headers: { 'x-goog-api-key': API_KEY } });
    if (!resp.ok) continue;

    const json = await resp.json().catch(() => ({}));
    const models: any[] = json?.models || [];

    const found = models.find((m) => {
      const name: string = m?.name || '';
      return name === `models/${target}` || name.endsWith(`/models/${target}`);
    });

    if (found) return { modelId: target, apiBase };
  }

  // 見つからなければ一覧の先頭10件を添えてエラー
  const fallback = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(API_KEY)}`, {
    headers: { 'x-goog-api-key': API_KEY },
  }).then(r => (r.ok ? r.json() : Promise.resolve({}))).catch(() => ({}));

  const sample = (fallback?.models || []).map((m: any) => m?.name).filter(Boolean).slice(0, 10);
  throw new Error(`Model "${target}" not found with your key. Available (sample) = ${sample.join(', ') || '[]'}`);
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
    if (!API_KEY) return res.status(500).json({ error: 'Server error', detail: 'Missing GEMINI_API_KEY' });
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Server error', detail: 'Missing Supabase credentials' });
    }

    // 認証（Authorization: Bearer <access_token>）
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: userInfo, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userInfo?.user) return res.status(401).json({ error: 'Invalid token' });
    const userId = userInfo.user.id;

    // 入力
    const { prompt, image1, image2, temperature } = req.body || {};
    if (!prompt || !image1) {
      return res.status(400).json({ error: 'Bad Request', detail: 'prompt and image1 are required' });
    }

    const p1 = splitDataUrl(image1);
    const p2 = splitDataUrl(image2);
    if (!p1) return res.status(400).json({ error: 'Bad Request', detail: 'image1 is invalid/empty' });
    // p2 は null 許容（空なら parts に入れない）

    // users 行 upsert（初回ユーザー）
    {
      const { data: row, error: selErr } = await supabase
        .from('users').select('id, credits_total, credits_used').eq('id', userId).single();

      if (selErr || !row) {
        const { error: upErr } = await supabase
          .from('users')
          .upsert({ id: userId, credits_total: 10, credits_used: 0 }, { onConflict: 'id' });
        if (upErr) return res.status(500).json({ error: 'Upsert user failed', detail: upErr.message });
      }
    }

    // 残回数チェック
    {
      const { data: row, error } = await supabase
        .from('users').select('credits_total, credits_used').eq('id', userId).single();
      if (error || !row) {
        return res.status(500).json({ error: 'DB error(select users)', detail: error?.message || 'row not found' });
      }
      const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
      if (remaining <= 0) return res.status(402).json({ error: 'No credits' });
    }

    // 先にクレジット消費（二重押し対策）
    {
      const { error } = await supabase.rpc('consume_credit', { p_user_id: userId });
      if (error) return res.status(409).json({ error: 'Consume failed', detail: error.message });
    }

    // モデル解決（ここが 404 対策の要）
    const { modelId, apiBase } = await resolveUsableModel(ENV_MODEL);
    const ENDPOINT = `https://generativelanguage.googleapis.com/${apiBase}/models/${modelId}:generateContent`;

    // 「画像で返す」ヒント（REST は response_mime_type 非対応）
    const systemText =
      'You are an image editing model. Always return the result as an IMAGE (inlineData). ' +
      'Do not include any textual explanation in the response parts.';

    const parts: any[] = [
      { text: prompt },
      { inline_data: { mime_type: p1.mime, data: p1.base64 } },
    ];
    if (p2) {
      parts.push({ inline_data: { mime_type: p2.mime, data: p2.base64 } });
    }

    const body = {
      systemInstruction: { role: 'system', parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: typeof temperature === 'number' ? temperature : 0.7,
      },
    };

    // タイムアウト
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 55_000);

    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).catch((e) => { throw new Error(`Fetch failed: ${String(e)}`); });

    clearTimeout(to);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return res.status(500).json({ error: 'Images API error', detail });
    }

    const json = await resp.json();

    // 画像パート抽出（snake/camel 両対応）
    const candidates = json?.candidates || [];
    const c0 = candidates[0]?.content?.parts || [];
    let imageBase64: string | null = null;
    let imageMime: string | null = null;
    const textOut: string[] = [];

    for (const part of c0) {
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
      return res.status(500).json({ error: 'No image in response', text: textOut.join('\n') });
    }

    return res.status(200).json({ image: { data: imageBase64, mimeType: imageMime } });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
