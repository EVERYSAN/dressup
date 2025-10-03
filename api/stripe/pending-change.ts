// api/stripe/pending-change.ts
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
    // --- 必須ENVチェック（無ければ 500 だが、明確なメッセージを返す）
    const STRIPE_API_KEY = requireEnv('STRIPE_API_KEY');
    const SUPA_URL       = requireEnv('SUPABASE_URL');
    const SUPA_SRK       = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });
    const supabase = createClient(SUPA_URL, SUPA_SRK);

    // --- 認証チェック
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.replace('Bearer ', '');
    if (!accessToken) return res.status(401).json({ error: 'unauthorized' });

    const { data: { user }, error: uerr } = await supabase.auth.getUser(accessToken);
    if (uerr || !user) {
      console.error('[pending-change] getUser error', uerr);
      return res.status(401).json({ error: 'unauthorized' });
    }

    // --- アプリの users から Stripe customer を引く
    const { data: row, error: rerr } = await supabase
      .from('users')
      .select('stripe_customer_id, plan, period_end')
      .eq('id', user.id)
      .single();

    if (rerr) {
      console.error('[pending-change] select users error', rerr);
      return res.status(200).json({ hasPending: false });
    }
    if (!row?.stripe_customer_id) {
      return res.status(200).json({ hasPending: false });
    }

    // --- 現在の subscription を取得
    let subs;
    try {
      subs = await stripe.subscriptions.list({
        customer: row.stripe_customer_id,
        status: 'active',
        limit: 1,
        expand: ['data.schedule', 'data.items.data.price.product'],
      });
    } catch (e) {
      console.error('[pending-change] stripe.subscriptions.list error', e);
      return res.status(200).json({ hasPending: false });
    }
    const sub = subs.data[0];
    if (!sub || !sub.schedule) {
      return res.status(200).json({ hasPending: false });
    }

    // --- schedule 取得
    let schedule;
    try {
      schedule = await stripe.subscriptionSchedules.retrieve(
        typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id
      );
    } catch (e) {
      console.error('[pending-change] retrieve schedule error', e);
      return res.status(200).json({ hasPending: false });
    }

    // --- 将来フェーズを探す
    const now = Math.floor(Date.now() / 1000);
    const futurePhase = schedule.phases?.find(ph => (ph.start_date as number) > now) || null;
    if (!futurePhase) {
      return res.status(200).json({ hasPending: false });
    }

    // --- 次のプラン推定
    const nextPriceId = futurePhase.items?.[0]?.price as string | undefined;
    let nextPlan: 'free' | 'light' | 'basic' | 'pro' | null = null;
    if (nextPriceId) {
      if (nextPriceId === process.env.STRIPE_PRICE_LIGHT) nextPlan = 'light';
      else if (nextPriceId === process.env.STRIPE_PRICE_BASIC) nextPlan = 'basic';
      else if (nextPriceId === process.env.STRIPE_PRICE_PRO)   nextPlan = 'pro';
    }

    return res.status(200).json({
      hasPending: true,
      currentPlan: (row.plan || 'free'),
      nextPlan,
      effectiveAt: futurePhase.start_date, // UNIX秒
    });
  } catch (e: any) {
    console.error('[pending-change] top-level error', e?.message || e);
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
}
