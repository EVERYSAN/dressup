// api/stripe/cancel-schedule.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: '2024-06-20',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: req.headers.authorization || '' } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: urow } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    const customerId = urow?.stripe_customer_id;
    if (!customerId) return res.status(200).json({ ok: true, canceled: false });

    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
    const sub = subs.data[0];
    if (!sub || !sub.schedule) return res.status(200).json({ ok: true, canceled: false });

    const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id;
    await stripe.subscriptionSchedules.cancel(scheduleId);

    return res.status(200).json({ ok: true, canceled: true });
  } catch (e) {
    console.error('[cancel-schedule] error', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
