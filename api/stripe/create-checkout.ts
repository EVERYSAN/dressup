import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { getUserFromRequest } from '../_utils/auth';
import { supabaseAdmin } from '../_utils/supabase';

const stripe = new Stripe(process.env.STRIPE_API_KEY!, { apiVersion: '2024-06-20' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const { plan } = (req.body || {}) as { plan: 'basic' | 'pro' };
  const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO! : process.env.STRIPE_PRICE_BASIC!;

  // users.stripe_customer_id を取得/なければ作成
  const { data } = await supabaseAdmin.from('users').select('stripe_customer_id').eq('id', user.id).single();
  let customerId = data?.stripe_customer_id as string | null;

  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email ?? undefined, metadata: { userId: user.id } });
    customerId = customer.id;
    await supabaseAdmin.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${process.env.APP_URL}/billing/success`,
    cancel_url: `${process.env.APP_URL}/billing/cancel`,
  });

  return res.status(200).json({ url: session.url });
}
