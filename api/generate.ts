// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// --- 必須: 環境変数 ---
// GEMINI_API_KEY は AI Studio のキー（API Key 認証）
// モデルは Gemini 2.5 Flash Image（a.k.a Nano Banana）を明示
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// dataURL → { mime, base64 } に正規化
function splitDataUrl(input: string): { mime: string; base64: string } {
  if (!input) return { mime: 'image/png', base64: '' };
  if (input.startsWith('data:')) {
    const [meta, b64] = input.split(',', 2);
    const mime = meta.match(/^data:(.*?);base64$/)?.[1] || 'image/png';
    return { mime, base64: b64 || '' };
  }
  // 既に base64 本体のみのとき
  return { mime: 'image/png', base64: input };
}

// Gemini 画像編集（Nano Banana = Gemini 2.5 Flash Image）
async function callGeminiEdit({
  prompt,
  image1,
  image2,
}: {
  prompt: string;
  image1: { mime: string; base64: string };
  image2?: { mime: string; base64: string } | null;
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_IMAGE_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const parts: any[] = [
    { text: prompt },
    { inline_data: { mime_type: image1.mime, data: image1.base64 } },
  ];
  if (image2?.base64) {
    parts.push({ inline_data: { mime_type: image2.mime, data: image2.base64 } });
  }

  const body = { contents: [{ parts }] };

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 60_000); // 60s タイムアウト
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`Gemini API error ${resp.status}: ${t}`);
    }
    const json = await resp.json();

    // 返却取り出し（candidates[].content.parts[].inlineData.data を優先）
    const partsOut = json?.candidates?.[0]?.content?.parts || [];
    const inline = partsOut.find((p: any) => p?.inlineData?.data)?.inlineData;
    const b64 = inline?.data as string | undefined;
    const mime = inline?.mimeType || 'image/png';
    if (!b64) throw new Error('No image in response');

    return { data: b64, mimeType: mime };
  } finally {
    clearTimeout(to);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS（必要に応じて）
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 1) 認証（Supabase の Bearer）
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: userInfo, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !userInfo?.user) return res.status(401).json({ error: 'Invalid token' });
    const userId = userInfo.user.id;

    // 2) 在庫チェック（id カラムを想定。テーブル定義に合わせて必要なら列名を変更）
    const { data: row, error: selErr } = await supabaseAdmin
      .from('users')
      .select('credits_total, credits_used')
      .eq('id', userId) // ← ここはあなたのテーブルの主キー名に合わせて ('uuid' なら .eq('uuid', userId))
      .single();

    if (selErr || !row) return res.status(500).json({ error: 'User row not found' });

    const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
    if (remaining <= 0) return res.status(402).json({ error: 'No credits' });

    // 3) 先に確実に消費（楽観的ロックは SQL 側の関数で担保）
    const { error: rpcErr } = await supabaseAdmin.rpc('consume_credit', { p_user_id: userId });
    if (rpcErr) return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });

    // 4) 入力検証
    const { prompt, image1, image2 = null } = (req.body || {}) as {
      prompt?: string;
      image1?: string;
      image2?: string | null;
    };
    if (!prompt || !image1) return res.status(400).json({ error: 'Missing prompt or image1' });

    const img1 = splitDataUrl(image1);
    const img2 = image2 ? splitDataUrl(image2) : null;

    // 5) 画像編集（Nano Banana = Gemini 2.5 Flash Image）
    const result = await callGeminiEdit({ prompt, image1: img1, image2: img2 });

    // 6) JSON で返す（フロントで確実に finally に到達させる）
    return res.status(200).json({ image: { data: result.data, mimeType: result.mimeType } });
  } catch (e: any) {
    // 例外時も JSON で返す
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
