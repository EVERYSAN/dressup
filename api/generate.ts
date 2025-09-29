// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ダミー生成（あなたの本番APIに差し替え）
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 1) 認証
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: userInfo, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userInfo?.user) return res.status(401).json({ error: 'Invalid token' });

    const supaUid = userInfo.user.id;
    const email = userInfo.user.email ?? null;

    // 2) users 行を取得（列名が uuid でない環境向けに両方試す）
    let sel = await admin.from('users')
      .select('uuid, credits_total, credits_used')
      .eq('uuid', supaUid)
      .maybeSingle();

    // 2-1) 無ければ自動作成（free:10）
    if (!sel.data) {
      const { error: upErr } = await admin.from('users').insert([{
        uuid: supaUid,            // ← もし列名が id の場合は id: supaUid に変更
        email,
        plan: 'free',
        credits_total: 10,
        credits_used: 0,
        created_at: new Date().toISOString(),
      }]);
      if (upErr) return res.status(500).json({ error: 'Upsert user failed', detail: upErr.message });

      // 作成した行を再取得
      sel = await admin.from('users')
        .select('uuid, credits_total, credits_used')
        .eq('uuid', supaUid)
        .single();
    }

    if (sel.error || !sel.data) {
      return res.status(500).json({ error: 'User row not found after upsert', detail: sel.error?.message });
    }

    // 3) 残回数チェック
    const remaining = (sel.data.credits_total ?? 0) - (sel.data.credits_used ?? 0);
    if (remaining <= 0) return res.status(402).json({ error: 'No credits' });

    // 4) 先に消費（競合に強い）
    const { error: rpcErr } = await admin.rpc('consume_credit', { p_user_id: supaUid });
    if (rpcErr) return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });

    // 5) 本処理
    const { prompt, image1, image2 = null, temperature = 0.7, seed = null } = (req.body as any) || {};
    if (!prompt || !image1) return res.status(400).json({ error: 'Missing prompt or image1' });

    const result = await callImageEditAPI({ prompt, image1, image2, temperature, seed });

    return res.status(200).json({ image: { data: result.data, mimeType: result.mimeType } });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
