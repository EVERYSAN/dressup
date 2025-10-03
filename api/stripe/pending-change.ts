// api/stripe/pending-change.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { getSessionUser, getStripeCustomerIdByUser } from './_helpers'; // 既存のヘルパを想定
import { mapPriceIdToPlan } from './_planMap';                           // いつもの price->plan/credits

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const customerId = await getStripeCustomerIdByUser(user.id);
    if (!customerId) return res.status(404).json({ error: 'Customer not found' });

    // アクティブ購読を 1 件取得
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
    const sub = subs.data[0];
    if (!sub) return res.status(200).json({ ok: true, pending: false });

    // 予約スケジュールが付いているか？
    if (sub.schedule) {
      const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id;
      const sched = await stripe.subscriptionSchedules.retrieve(scheduleId, { expand: ['phases.items.price'] });

      // “次のフェーズ” を見て適用日・対象プランを出す
      const next = sched.phases[1] ?? null;
      if (!next) return res.status(200).json({ ok: true, pending: false });

      const applyAt = next.start_date ?? null;
      const price = next.items?.[0]?.price ?? null;
      const toPlan = price && typeof price !== 'string'
        ? mapPriceIdToPlan(price.id)?.plan ?? null
        : null;

      return res.status(200).json({
        ok: true,
        pending: true,
        scheduleId,
        applyAt,
        toPlan,
      });
    }

    // schedule が付いていなければ未予約
    return res.status(200).json({ ok: true, pending: false });

  } catch (e: any) {
    console.error('[pending-change] error', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
