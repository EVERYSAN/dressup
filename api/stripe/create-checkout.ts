// /api/stripe/create-checkout.ts
import Stripe from 'stripe';

export const runtime = 'nodejs';           // Vercel Functions
export const dynamic = 'force-dynamic';    // キャッシュさせない

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: '2024-06-20',
});

type Body = {
  plan: 'light' | 'basic' | 'pro';
  userId: string; // supabase.auth.getUser().id を渡す
};

export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const { plan, userId } = (await req.json()) as Partial<Body>;

    if (!plan || !userId) {
      return new Response('Missing plan or userId', { status: 400 });
    }

    const priceId =
      plan === 'light' ? process.env.STRIPE_PRICE_LIGHT :
      plan === 'basic' ? process.env.STRIPE_PRICE_BASIC :
      plan === 'pro'   ? process.env.STRIPE_PRICE_PRO   : undefined;

    if (!priceId) {
      return new Response('Unknown plan', { status: 400 });
    }

    const successUrl = `${process.env.NEXT_PUBLIC_APP_URL}/?status=success`;
    const cancelUrl  = `${process.env.NEXT_PUBLIC_APP_URL}/?status=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url : cancelUrl,
      allow_promotion_codes: true,
      // Webhook でユーザーを紐づける重要情報
      metadata: { user_id: userId },

      // あると便利：毎月の invoice 用にカード名義や住所を集められる
      // customer_creation: 'if_required', // or 'always'
      // customer_update: { address: 'auto' },
    });

    return Response.json({ url: session.url }, { status: 200 });
  } catch (err: any) {
    console.error('create-checkout error', err);
    return new Response(`Error: ${err?.message ?? 'unknown'}`, { status: 500 });
  }
}
