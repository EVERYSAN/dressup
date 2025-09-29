// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * ========= 環境変数 =========
 * GEMINI_API_KEY            : 必須（AI Studio API Key）
 * GEMINI_IMAGE_MODEL        : 例) gemini-2.5-flash-image
 * GEMINI_IMAGES_ENDPOINT    : 既定 https://generativelanguage.googleapis.com/v1beta
 * SUPABASE_URL              : 既存
 * SUPABASE_SERVICE_ROLE_KEY : 既存
 * ECHO_GENERATE             : "true" でスモーク（ベース画像をそのまま返す）
 */
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_IMAGES_ENDPOINT =
  process.env.GEMINI_IMAGES_ENDPOINT ||
  'https://generativelanguage.googleapis.com/v1beta';

// スモーク: 画像をそのまま返す（配線確認）
const ECHO_GENERATE = String(process.env.ECHO_GENERATE || '').toLowerCase() === 'true';

/* ------------------------------ ユーティリティ ------------------------------ */

// base64 先頭に dataURL が付いていたら取り除く
function stripDataUrl(b64: string) {
  const comma = b64.indexOf(',');
  if (b64.startsWith('data:') && comma >= 0) return b64.slice(comma + 1);
  return b64;
}

type EditPayload = {
  prompt: string;
  image1: string;                 // base64 or dataURL
  image2?: string | null;         // base64 or dataURL
  temperature?: number;
  seed?: number | null;
};

/* --------------------------- Images API 呼び出し --------------------------- */

/**
 * Images API: generate（1枚生成）
 * https://generativelanguage.googleapis.com/v1beta/images:generate
 */
async function callImagesGenerate({
  prompt,
  image1,
}: {
  prompt: string;
  image1: string;
}) {
  const url = `${GEMINI_IMAGES_ENDPOINT}/images:generate?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const body = {
    // AI Studio Images API のフォーマット
    model: `models/${GEMINI_IMAGE_MODEL}`,
    prompt,
    // 1枚目は「ベース画像」として参考に渡す（反映するためのヒント）
    // API 仕様上「sources」に置く。mimeType は png/jpg どちらでもOK
    // 実際の仕様差異に対応できるよう柔軟に組んでいます
    sources: [
      {
        mimeType: 'image/png',
        data: stripDataUrl(image1),
      },
    ],
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Images API error ${resp.status}: ${text}`);
  }

  // 返り値の多様性を考慮して複数パスをチェック
  const json = await resp.json();
  // 1) AI Studio Images API 典型: { images: [{ data: base64, mimeType }] }
  if (json?.images?.length) {
    const img = json.images[0];
    return { data: img.data as string, mimeType: img.mimeType || 'image/png' };
  }
  // 2) Vertex 互換形（念のため）
  if (json?.predictions?.length) {
    const p = json.predictions[0];
    if (p?.bytesBase64Encoded) {
      return { data: p.bytesBase64Encoded as string, mimeType: 'image/png' };
    }
  }

  throw new Error('No image in response');
}

/**
 * Images API: edits（画像置き換え・合成）
 * https://generativelanguage.googleapis.com/v1beta/images:edits
 */
async function callImagesEdits({
  prompt,
  image1,
  image2,
}: {
  prompt: string;
  image1: string;
  image2: string;
}) {
  const url = `${GEMINI_IMAGES_ENDPOINT}/images:edits?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const body = {
    model: `models/${GEMINI_IMAGE_MODEL}`,
    prompt,
    // sources にベースと参照を順に渡す（実運用では役割プロパティがあるモデルもあるが、
    // ここでは最も広く通る「sources」配列に2枚入れる方式で実装）
    sources: [
      { mimeType: 'image/png', data: stripDataUrl(image1) }, // ベース（編集対象）
      { mimeType: 'image/png', data: stripDataUrl(image2) }, // 参照（置き換え先など）
    ],
    // mask を使う場合はここに追加（UI 側で必要になったら拡張）
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Images API error ${resp.status}: ${text}`);
  }

  const json = await resp.json();

  if (json?.images?.length) {
    const img = json.images[0];
    return { data: img.data as string, mimeType: img.mimeType || 'image/png' };
  }
  if (json?.predictions?.length) {
    const p = json.predictions[0];
    if (p?.bytesBase64Encoded) {
      return { data: p.bytesBase64Encoded as string, mimeType: 'image/png' };
    }
  }

  throw new Error('No image in response');
}

/* --------------------------------- Handler -------------------------------- */

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

    // ===== 認証（Bearer token） =====
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    // ===== Supabase 管理クライアント =====
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // トークンからユーザー
    const { data: userInfo, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userInfo?.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const userId = userInfo.user.id;

    // ===== 在庫チェック =====
    const { data: row, error: selErr } = await supabase
      .from('users')
      .select('credits_total, credits_used')
      .eq('id', userId)              // ← ※ usersテーブルの「authユーザーID」を格納している列名に合わせて下さい
      .single();

    if (selErr || !row) {
      return res.status(500).json({ error: 'User row not found' });
    }
    const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
    if (remaining <= 0) {
      return res.status(402).json({ error: 'No credits' });
    }

    // ===== リクエスト取り出し =====
    const { prompt, image1, image2 = null }: EditPayload = req.body || {};
    if (!prompt || !image1) {
      return res.status(400).json({ error: 'Missing prompt or image1' });
    }

    // ===== 先に1回分消費（競合に強い）=====
    const { error: rpcErr } = await supabase.rpc('consume_credit', { p_user_id: userId });
    if (rpcErr) {
      return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });
    }

    // ===== スモーク（配線確認用） =====
    if (ECHO_GENERATE) {
      return res.status(200).json({
        image: { data: stripDataUrl(image1), mimeType: 'image/png' },
        echo: true,
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server error', detail: 'Missing GEMINI_API_KEY' });
    }

    // ===== 画像生成 / 編集（Images API）=====
    let out;
    if (image2) {
      out = await callImagesEdits({ prompt, image1, image2 });
    } else {
      out = await callImagesGenerate({ prompt, image1 });
    }

    return res.status(200).json({ image: out });
  } catch (e: any) {
    // 例外時も JSON で返す
    return res.status(500).json({
      error: 'Server error',
      detail: String(e?.message || e),
    });
  }
}
