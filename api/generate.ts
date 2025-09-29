// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// backend switch
const ECHO = process.env.ECHO_GENERATE === 'true';
const NANO_URL = process.env.NANOBANANA_URL;
const NANO_KEY = process.env.NANOBANANA_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --------- helpers ----------
function json(res: VercelResponse, code: number, body: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(body));
}

async function callNanoBanana(params: {
  prompt: string;
  image1: string;
  image2?: string | null;
  temperature?: number;
  seed?: number | null;
}) {
  if (!NANO_URL || !NANO_KEY) {
    throw new Error('NanoBanana is not configured');
  }
  const resp = await fetch(`${NANO_URL.replace(/\/$/, '')}/edit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${NANO_KEY}`,
    },
    body: JSON.stringify(params),
    // タイムアウトは環境に合わせて
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`NanoBanana error ${resp.status}: ${text}`);
  }
  // { image: { data: base64, mimeType: string } } を期待
  return resp.json();
}

// ここは “テキストAPIの generateContent” ではなく “Images API（Flash Image）” を使うこと。
async function callGeminiImagesAPI(params: {
  prompt: string;
  image1: string;
  image2?: string | null;
  temperature?: number;
  seed?: number | null;
}) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  // 👇 実際の Images API エンドポイント＆モデルはプロジェクト/地域で異なります。
  //    「ListModels」で有効モデルを確認して、URL と model を差し替えてください。
  //    以下は“雛形”です。テキスト API の generateContent には投げないでください。
  const model = process.env.GEMINI_IMAGE_MODEL || 'imagen-3.0-fast'; // 例。環境に合わせて変更
  const endpoint =
    process.env.GEMINI_IMAGES_ENDPOINT ||
    'https://imagegeneration.googleapis.com/v1beta/projects/-/locations/us-central1/models'; // 例

  const url = `${endpoint}/${encodeURIComponent(model)}:edit`; // 例: :generate / :edit など実APIに合わせて

  const body = {
    // 実API仕様に合わせて調整（以下はイメージ）
    prompt: params.prompt,
    image1: params.image1, // base64 dataURL or raw base64
    image2: params.image2 ?? undefined,
    temperature: params.temperature ?? 0.7,
    seed: params.seed ?? undefined,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GEMINI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Images API error ${resp.status}: ${text}`);
  }
  // 返却はアプリ都合に正規化（常に同じ形で返す）
  const data = await resp.json();
  // data から base64 と mimeType を取り出して正規化
  const imageBase64 = data?.image?.base64 ?? data?.candidates?.[0]?.image?.base64;
  const mime = data?.image?.mimeType ?? 'image/png';
  if (!imageBase64) throw new Error('Images API returned no image');
  return { image: { data: imageBase64, mimeType: mime } };
}

// ダミー応答(スモーク)
function echoImage(image1: string) {
  return { image: { data: image1, mimeType: 'image/png' } };
}

// --------- handler ----------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      return json(res, 405, { error: 'Method Not Allowed' });
    }

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return json(res, 401, { error: 'Missing bearer token' });

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: userInfo, error: userErr } = await supa.auth.getUser(token);
    if (userErr || !userInfo?.user) return json(res, 401, { error: 'Invalid token' });
    const userId = userInfo.user.id;

    // ユーザ行の確保（存在しない時に備えて upsert したい場合はここで）
    const { data: userRow, error: selErr } = await supa
      .from('users')
      .select('credits_total, credits_used, plan')
      .eq('id', userId) // ←あなたのスキーマは id が supabase auth UID。uuid 列は無い
      .single();
    if (selErr || !userRow) return json(res, 500, { error: 'User row not found' });

    const remaining = (userRow.credits_total ?? 0) - (userRow.credits_used ?? 0);
    if (remaining <= 0) return json(res, 402, { error: 'No credits' });

    // 先に消費（二重実行耐性は DB 側の関数で担保）
    const { error: rpcErr } = await supa.rpc('consume_credit', { p_user_id: userId });
    if (rpcErr) return json(res, 409, { error: 'Consume failed', detail: rpcErr.message });

    // 入力
    const { prompt, image1, image2 = null, temperature = 0.7, seed = null } = req.body || {};
    if (!prompt || !image1) return json(res, 400, { error: 'Missing prompt or image1' });

    // 生成の経路分岐
    let out;
    if (ECHO) {
      out = echoImage(image1);
    } else if (NANO_URL && NANO_KEY) {
      out = await callNanoBanana({ prompt, image1, image2, temperature, seed });
    } else {
      out = await callGeminiImagesAPI({ prompt, image1, image2, temperature, seed });
    }

    return json(res, 200, out);
  } catch (e: any) {
    return json(res, 500, { error: 'Server error', detail: String(e?.message || e) });
  }
}
