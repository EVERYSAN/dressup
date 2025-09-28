// api/stripe/create-checkout.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { getUserFromRequest } from '../_utils/auth';      // Authorization: Bearer <supabase_jwt>
import { supabaseAdmin } from '../_utils/supabase';

const stripe = new Stripe(process.env.STRIPE_API_KEY as string, {
  apiVersion: '2024-09-30.acacia',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { plan } = (req.body || {}) as { plan?: 'light' | 'basic' | 'pro' };
    const priceMap: Record<string, string | undefined> = {
      light: process.env.STRIPE_PRICE_LIGHT,
      basic: process.env.STRIPE_PRICE_BASIC,
      pro:   process.env.STRIPE_PRICE_PRO,
    };
    const price = plan ? priceMap[plan] : undefined;
    if (!price) return res.status(400).json({ error: 'invalid plan or price not set' });

    // 既存カスタマーの取得/作成
    let customerId: string | undefined;
    const { data: u } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    customerId = u?.stripe_customer_id || undefined;

    if (!customerId) {
      const c = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = c.id;
      await supabaseAdmin.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.PUBLIC_APP_URL ||
      `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${origin}/?success=1`,
      cancel_url: `${origin}/?canceled=1`,
      allow_promotion_codes: true,
      metadata: { user_id: user.id, plan },
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[create-checkout] error', e);
    return res.status(500).send(e?.message ?? 'internal error');
  }
}
