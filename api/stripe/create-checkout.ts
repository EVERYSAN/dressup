// api/stripe/create-checkout.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { getUserFromRequest } from '../_utils/auth';
import { supabaseAdmin } from '../_utils/supabase';

// ── Stripe 初期化（apiVersion はプロジェクトの型に合わせる）
const stripe = new Stripe(process.env.STRIPE_API_KEY as string, {
  apiVersion: '2024-06-20',
} as Stripe.StripeConfig);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    if (!process.env.STRIPE_API_KEY) {
      return res.status(500).json({ error: 'missing STRIPE_API_KEY' });
    }

    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { plan } = (req.body || {}) as { plan?: 'light' | 'basic' | 'pro' };

    const priceMap: Record<string, string | undefined> = {
      light: process.env.STRIPE_PRICE_LIGHT,
      basic: process.env.STRIPE_PRICE_BASIC,
      pro:   process.env.STRIPE_PRICE_PRO,
    };

    const price = plan ? priceMap[plan] : undefined;

    // ★ ここで未設定を早期リターン（以降は string として扱える）
    if (!price) {
      return res.status(400).json({ error: 'invalid plan or price env not set', plan });
    }

    // 既存 customerId を探す or 作成
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
      await supabaseAdmin
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.PUBLIC_APP_URL ||
      `https://${req.headers.host}`;

    // ★ price は string 確定
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: price as string, quantity: 1 }],
      success_url: `${origin}/?success=1`,
      cancel_url: `${origin}/?canceled=1`,
      allow_promotion_codes: true,
      metadata: { user_id: user.id, plan },
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[create-checkout] error:', e);
    // 500 でも JSON を返す（フロントの JSON パースエラー回避）
    return res.status(500).json({ error: e?.message ?? 'internal error' });
  }
}
