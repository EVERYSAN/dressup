// api/stripe/pending-change.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

// env の price -> plan/credits マップ（既存と同値に）
const PRICE_LIGHT = process.env.STRIPE_PRICE_LIGHT!;
const PRICE_BASIC = process.env.STRIPE_PRICE_BASIC!;
const PRICE_PRO   = process.env.STRIPE_PRICE_PRO!;
type Plan = 'free'|'light'|'basic'|'pro';
function mapPriceIdToPlan(priceId: string): { plan: Plan; credits: number } | null {
  switch (priceId) {
    case PRICE_LIGHT: return { plan: 'light', credits: 100 };
    case PRICE_BASIC: return { plan: 'basic', credits: 500 };
    case PRICE_PRO:   return { plan: 'pro',   credits: 1200 };
    default:          return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // Supabase（ユーザ識別用）
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: req.headers.authorization || '' } } }
    );
    const { data: { user }, error: getUserErr } = await supabase.auth.getUser();
    if (getUserErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    // stripe_customer_id を users から取る
    const { data: urow, error: qerr } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    if (qerr) return res.status(500).json({ error: 'Server error' });
    const customerId = urow?.stripe_customer_id;
    if (!customerId) return res.status(200).json({ ok: true, pending: false });

    // アクティブ購読
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
    const sub = subs.data[0];
    if (!sub) return res.status(200).json({ ok: true, pending: false });

    // 予約スケジュールの確認
    if (sub.schedule) {
      const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id;
      const sched = await stripe.subscriptionSchedules.retrieve(scheduleId, { expand: ['phases.items.price'] });

      const next = sched.phases?.[1] ?? null;
      if (!next) return res.status(200).json({ ok: true, pending: false });

      const applyAt = next.start_date ?? null;
      const priceObj = next.items?.[0]?.price ?? null;
      const priceId = typeof priceObj === 'string' ? priceObj : priceObj?.id;
      const mapped = priceId ? mapPriceIdToPlan(priceId) : null;

      return res.status(200).json({
        ok: true,
        pending: true,
        scheduleId,
        applyAt,
        toPlan: mapped?.plan ?? null,
      });
    }

    return res.status(200).json({ ok: true, pending: false });
  } catch (e) {
    console.error('[pending-change] error', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
