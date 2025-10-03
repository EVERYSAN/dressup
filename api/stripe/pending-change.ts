// api/stripe/pending-change.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: '2024-06-20',
});

// Supabase（既存のクライアントファイルがあるならそちらでもOK）
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // 読み取りだけでも SRK が安全
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 認証ユーザーの subscription を突き止める
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.replace('Bearer ', '');
    if (!accessToken) return res.status(401).json({ error: 'unauthorized' });

    const { data: { user }, error: uerr } = await supabase.auth.getUser(accessToken);
    if (uerr || !user) return res.status(401).json({ error: 'unauthorized' });

    const { data: row, error: rerr } = await supabase
      .from('users')
      .select('stripe_customer_id, plan, period_end')
      .eq('id', user.id)
      .single();

    if (rerr || !row?.stripe_customer_id) {
      return res.status(200).json({ hasPending: false }); // 予約なし扱い
    }

    // 現在の Subscription を取得（customer から引く）
    const subs = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: 'active',
      limit: 1,
      expand: ['data.schedule', 'data.items.data.price.product'],
    });
    const sub = subs.data[0];
    if (!sub) return res.status(200).json({ hasPending: false });

    // 予約は Subscription Schedule にぶら下がる
    // schedule が無ければ予約はない
    if (!sub.schedule) {
      return res.status(200).json({ hasPending: false });
    }

    // schedule の将来フェーズを探す
    const schedule = await stripe.subscriptionSchedules.retrieve(
      typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id
    );

    const now = Math.floor(Date.now() / 1000);
    const futurePhase =
      schedule.phases?.find(ph => (ph.start_date as number) > now) || null;

    if (!futurePhase) {
      return res.status(200).json({ hasPending: false });
    }

    // 次フェーズの先頭アイテムの price から “次のプラン” を推定
    const nextPriceId = futurePhase.items?.[0]?.price as string | undefined;
    let nextPlan: 'light' | 'basic' | 'pro' | 'free' | null = null;
    if (nextPriceId) {
      if (nextPriceId === process.env.STRIPE_PRICE_LIGHT) nextPlan = 'light';
      else if (nextPriceId === process.env.STRIPE_PRICE_BASIC) nextPlan = 'basic';
      else if (nextPriceId === process.env.STRIPE_PRICE_PRO) nextPlan = 'pro';
    }

    return res.status(200).json({
      hasPending: true,
      currentPlan: (row.plan || 'free'),
      nextPlan,
      effectiveAt: futurePhase.start_date, // UNIX 秒
    });
  } catch (e: any) {
    console.error('[pending-change] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
