// api/stripe/create-checkout.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { getUserFromRequest } from '../_utils/auth';
import { supabaseAdmin } from '../_utils/supabase';

const stripe = new Stripe(process.env.STRIPE_API_KEY as string, {
  apiVersion: '2024-09-30.acacia',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const { plan }:{ plan:'light'|'basic'|'pro' } = req.body || {};
  const priceMap: Record<string, string | undefined> = {
    light: process.env.STRIPE_PRICE_LIGHT,
    basic: process.env.STRIPE_PRICE_BASIC,
    pro: process.env.STRIPE_PRICE_PRO,
  };
  const price = priceMap[plan];
  if (!price) return res.status(400).json({ error: 'invalid plan' });

  // 顧客の紐付け（既存 or 新規）
  let customerId: string | undefined;
  const { data: u } = await supabaseAdmin.from('users').select('stripe_customer_id').eq('id', user.id).single();
  customerId = u?.stripe_customer_id || undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await supabaseAdmin.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLICK_APP_URL ?? process.env.PUBLIC_APP_URL ?? 'https://'+req.headers.host}/?success=1`,
    cancel_url: `${process.env.NEXT_PUBLICK_APP_URL ?? process.env.PUBLIC_APP_URL ?? 'https://'+req.headers.host}/?canceled=1`,
    allow_promotion_codes: true,
    metadata: { user_id: user.id, plan }
  });

  return res.status(200).json({ url: session.url });
}
