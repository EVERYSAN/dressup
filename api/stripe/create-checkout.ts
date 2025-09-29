import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

const STRIPE_API_KEY = process.env.STRIPE_API_KEY || '';
const PRICE_LIGHT    = process.env.STRIPE_PRICE_LIGHT || '';
const PRICE_BASIC    = process.env.STRIPE_PRICE_BASIC || '';
const PRICE_PRO      = process.env.STRIPE_PRICE_PRO   || '';

// ← ここが修正点。|| と ?? を混ぜない & 予備の固定URLを用意
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.dressupai.app').replace(/\/+$/, '');

const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });

type Plan = 'light' | 'basic' | 'pro';

function priceFromPlan(plan: Plan): string | null {
  switch (plan) {
    case 'light': return PRICE_LIGHT || null;
    case 'basic': return PRICE_BASIC || null;
    case 'pro'  : return PRICE_PRO   || null;
    default     : return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const body = (typeof req.body === 'string') ? JSON.parse(req.body) : (req.body ?? {});
    const plan = body.plan as Plan | undefined;

    if (!plan || !['light', 'basic', 'pro'].includes(plan)) {
      res.status(400).json({ error: 'plan is required: "light" | "basic" | "pro"' });
      return;
    }
    if (!STRIPE_API_KEY) {
      res.status(500).json({ error: 'Missing STRIPE_API_KEY' });
      return;
    }

    const priceId = priceFromPlan(plan);
    if (!priceId) {
      res.status(500).json({ error: `Missing price id for plan "${plan}"` });
      return;
    }

    const success_url = `${APP_URL}/?checkout=success&plan=${plan}`;
    const cancel_url  = `${APP_URL}/?checkout=cancel&plan=${plan}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      metadata: { plan },
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url });
  } catch (err: any) {
    console.error('[create-checkout] error:', err);
    res.status(500).json({
      error: 'create-checkout failed',
      message: err?.message ?? String(err),
      code: err?.code ?? undefined,
    });
  }
}
