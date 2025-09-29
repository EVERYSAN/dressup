import Stripe from 'stripe';

export const config = { runtime: 'nodejs18.x' }; // 省略可（Vercel の場合）

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: '2024-06-20',
});

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let plan: 'light' | 'basic' | 'pro' | undefined;
  try {
    const body = await req.json();            // ← JSON を受け取る
    plan = body?.plan;
  } catch {
    /* noop */
  }
  if (!plan) {
    return new Response(JSON.stringify({ error: 'plan is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const priceIdMap: Record<'light'|'basic'|'pro', string> = {
    light: process.env.STRIPE_PRICE_LIGHT!,
    basic: process.env.STRIPE_PRICE_BASIC!,
    pro:   process.env.STRIPE_PRICE_PRO!,
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceIdMap[plan], quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/?success=1`,
    cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/?canceled=1`,
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
