// api/stripe/cancel-schedule.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { getSessionUser, getStripeCustomerIdByUser } from './_helpers';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const customerId = await getStripeCustomerIdByUser(user.id);
    if (!customerId) return res.status(404).json({ error: 'Customer not found' });

    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
    const sub = subs.data[0];
    if (!sub || !sub.schedule) return res.status(200).json({ ok: true, canceled: false });

    const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id;
    await stripe.subscriptionSchedules.cancel(scheduleId);
    return res.status(200).json({ ok: true, canceled: true });
  } catch (e: any) {
    console.error('[cancel-schedule] error', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
