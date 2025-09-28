import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserFromRequest } from './_utils/auth';
import { supabaseAdmin } from './_utils/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  // 残数を確認
  const { data: u } = await supabaseAdmin.from('users')
    .select('credits_total, credits_used')
    .eq('id', user.id).single();

  const remaining = (u?.credits_total ?? 0) - (u?.credits_used ?? 0);
  if (remaining <= 0) {
    return res.status(402).json({ error: 'No credits' }); // 402 Payment Required
  }

  // 生成処理（ここにAI呼び出しなどを実装）--------------------------------
  // const result = await runImageEdit(req.body);
  // ---------------------------------------------------------------------

  // 原子的に1消費（RPC推奨。直更新でもOK）
  const { error } = await supabaseAdmin.rpc('consume_credit', { p_user_id: user.id });
  if (error) return res.status(500).json({ error: 'consume failed' });

  return res.status(200).json({
    ok: true,
    remaining: remaining - 1,
    // result
  });
}
