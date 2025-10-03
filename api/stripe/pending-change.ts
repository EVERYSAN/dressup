import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`ENV ${name} is required`);
  return v;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 必須ENV
    const STRIPE_API_KEY = requireEnv('STRIPE_API_KEY');                // ※test/本番のキーに注意
    const SUPA_URL       = requireEnv('SUPABASE_URL');
    const SUPA_SRK       = requireEnv('SUPABASE_SERVICE_ROLE_KEY');     // サービスロール
    const SUPA_ANON      = requireEnv('SUPABASE_ANON_KEY');

    const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });

    // フロントからの Bearer トークンで“誰のリクエストか”を確定
    const auth = (req.headers.authorization ?? '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // 認証用（ユーザー特定）
    const supaUser = createClient(SUPA_URL, SUPA_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

    // DB操作用（サービスロール）
    const admin = createClient(SUPA_URL, SUPA_SRK);

    // アプリDBから stripe_customer_id 取得
    const { data: row, error: rerr } = await admin
      .from('users')
      .select('stripe_customer_id, plan, period_end')
      .eq('id', userData.user.id)
      .single();

    if (rerr || !row?.stripe_customer_id) {
      if (rerr) console.error('[pending-change] select users error', rerr);
      return res.status(200).json({ hasPending: false });
    }

    // 現在の subscription を取得（schedule を expand）
    let subList;
    try {
      subList = await stripe.subscriptions.list({
        customer: row.stripe_customer_id,
        status: 'active',
        limit: 1,
        expand: ['data.schedule', 'data.items.data.price.product'],
      });
    } catch (e) {
      console.error('[pending-change] stripe.subscriptions.list error', e);
      return res.status(200).json({ hasPending: false });
    }

    const sub = subList.data[0];
    if (!sub || !sub.schedule) {
      return res.status(200).json({ hasPending: false });
    }

    // schedule 取得（schedule はIDまたはオブジェクトのどちらか）
    let schedule;
    try {
      schedule = await stripe.subscriptionSchedules.retrieve(
        typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id
      );
    } catch (e) {
      console.error('[pending-change] retrieve schedule error', e);
      return res.status(200).json({ hasPending: false });
    }

    // 将来フェーズ（start_date が現在より未来）を探す
    const now = Math.floor(Date.now() / 1000);
    const futurePhase =
      schedule.phases?.find((ph) => (ph.start_date as number) > now) ?? null;
    if (!futurePhase) {
      return res.status(200).json({ hasPending: false });
    }

    // 次のプランを推定
    const nextPriceId = (futurePhase.items?.[0]?.price as string | undefined) ?? null;
    let nextPlan: 'free' | 'light' | 'basic' | 'pro' | null = null;
    if (nextPriceId) {
      if (nextPriceId === process.env.STRIPE_PRICE_LIGHT) nextPlan = 'light';
      else if (nextPriceId === process.env.STRIPE_PRICE_BASIC) nextPlan = 'basic';
      else if (nextPriceId === process.env.STRIPE_PRICE_PRO)   nextPlan = 'pro';
    }

    return res.status(200).json({
      hasPending: true,
      currentPlan: row.plan ?? 'free',
      nextPlan,
      effectiveAt: futurePhase.start_date, // UNIX秒
      // Header 側で使う互換フィールド
      toPlan: nextPlan,
      applyAt: (futurePhase.start_date as number) ?? null,
    });
  } catch (e: any) {
    console.error('[pending-change] top-level error', e?.message || e);
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
}
