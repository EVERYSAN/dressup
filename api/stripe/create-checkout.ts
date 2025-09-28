// /api/stripe/create-checkout.ts (Next.js API Route)
import Stripe from 'stripe';
import { getUser } from '@/lib/auth';
import { upsertCustomer } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export default async function handler(req, res) {
  const user = await getUser(req); // 認証
  if (!user) return res.status(401).end();

  const { priceId } = req.body; // 'basic' or 'pro' を安全にマップ
  const customerId = await upsertCustomer(user); // DBとStripeの紐付け

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${process.env.APP_URL}/billing/success`,
    cancel_url: `${process.env.APP_URL}/billing/cancel`,
  });

  res.json({ url: session.url });
}
