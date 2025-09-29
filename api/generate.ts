// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// 画像生成の擬似関数（ここをあなたの Gemini / 外部API 呼び出しに差し替え）
async function callImageEditAPI({
  prompt, image1, image2, temperature, seed,
}: { prompt: string; image1: string; image2?: string | null; temperature?: number; seed?: number | null; }) {
  // 必ず 40〜60 秒以内に終わらせるか、タイムアウト制御を入れること
  // ここではダミーの透明 1x1 PNG を返します
  const dummyBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  return { data: dummyBase64, mimeType: 'image/png' };
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

    // 1) Authorization からユーザー特定
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: userInfo, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userInfo?.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const userId = userInfo.user.id;

    // 2) 在庫チェック（DB の users 残回数 = credits_total - credits_used）
    const { data: row, error: selErr } = await supabaseAdmin
      .from('users')
      .select('credits_total, credits_used')
      .eq('uuid', userId)
      .single();

    if (selErr || !row) {
      return res.status(500).json({ error: 'User row not found' });
    }
    const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
    if (remaining <= 0) {
      return res.status(402).json({ error: 'No credits' }); // フロントで「プラン購入」誘導
    }

    // 3) まず消費してから生成（二重実行に強い）
    const { error: rpcErr } = await supabaseAdmin.rpc('consume_credit', { p_user_id: userId });
    if (rpcErr) {
      // 競合や RLS で失敗したら 409（もう一度押してもらう）
      return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });
    }

    // 4) 画像生成
    const { prompt, image1, image2 = null, temperature = 0.7, seed = null } = req.body || {};
    if (!prompt || !image1) {
      return res.status(400).json({ error: 'Missing prompt or image1' });
    }

    const result = await callImageEditAPI({ prompt, image1, image2, temperature, seed });

    // 5) 常に JSON を返す（フロントが確実に finally に到達できるように）
    return res.status(200).json({
      image: { data: result.data, mimeType: result.mimeType },
    });
  } catch (e: any) {
    // 例外時も JSON を返す
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
