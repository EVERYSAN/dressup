// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// 画像生成のダミー（外部APIに差し替えてOK）
async function callImageEditAPI({
  prompt, image1, image2, temperature, seed,
}: { prompt: string; image1: string; image2?: string | null; temperature?: number; seed?: number | null; }) {
  const dummyBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  return { data: dummyBase64, mimeType: 'image/png' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) トークン→ユーザーID
    const { data: userInfo, error: userErr } = await supa.auth.getUser(token);
    if (userErr || !userInfo?.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const userId = userInfo.user.id;

    // 2) 残クレジットを RPC で取得（列名に触れない）
    const { data: creditsRow, error: gErr } = await supa
      .rpc('get_user_credits', { p_user_id: userId })
      .single();

    if (gErr || !creditsRow) {
      return res.status(500).json({ error: 'DB error(get_user_credits)', detail: gErr?.message ?? 'no row' });
    }
    const remaining = (creditsRow.credits_total ?? 0) - (creditsRow.credits_used ?? 0);
    if (remaining <= 0) {
      return res.status(402).json({ error: 'No credits' });
    }

    // 3) 先に消費（競合時は 409）
    const { error: cErr } = await supa.rpc('consume_credit', { p_user_id: userId });
    if (cErr) {
      // no-credits 例外などもここに来る
      return res.status(409).json({ error: 'Consume failed', detail: cErr.message });
    }

    // 4) 画像生成（実サービスに置換）
    const { prompt, image1, image2 = null, temperature = 0.7, seed = null } = req.body || {};
    if (!prompt || !image1) {
      return res.status(400).json({ error: 'Missing prompt or image1' });
    }
    const result = await callImageEditAPI({ prompt, image1, image2, temperature, seed });

    // 5) JSON で返す
    return res.status(200).json({
      image: { data: result.data, mimeType: result.mimeType },
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
