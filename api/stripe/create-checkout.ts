import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { getUserFromRequest } from '../_utils/auth';
import { supabaseAdmin } from '../_utils/supabase';

const stripe = new Stripe(process.env.STRIPE_API_KEY as string, {
  apiVersion: '2024-06-20', // v16 の型に合う日付
} as Stripe.StripeConfig);

type Plan = 'light' | 'basic' | 'pro';

const PRICE_ENV: Record<Plan, string | undefined> = {
  light: process.env.STRIPE_PRICE_LIGHT,
  basic: process.env.STRIPE_PRICE_BASIC,
  pro: process.env.STRIPE_PRICE_PRO,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (!process.env.STRIPE_API_KEY) return res.status(500).json({ error: 'missing STRIPE_API_KEY' });

    // JSON で来なかった場合の保険
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    // plan をバリデーションして Plan 型に確定させる
    const planRaw = body?.plan as string | undefined;
    if (!planRaw || !['light', 'basic', 'pro'].includes(planRaw)) {
      return res.status(400).json({ error: 'plan must be one of: light | basic | pro' });
    }
    const plan = planRaw as Plan;

    const price = PRICE_ENV[plan];
    if (!price) return res.status(500).json({ error: `price id env not set for ${plan}` });

    // 既存 customer を探す or 作成
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

    // ここまで来れば plan は Plan（= string）なので metadata も型 OK
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/?success=1`,
      cancel_url: `${origin}/?canceled=1`,
      metadata: { user_id: user.id, plan },
    });

    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    console.error('[create-checkout] error:', err);
    // 500 でも JSON を返す（フロントで JSON.parse エラーにならないように）
    return res.status(500).json({ error: err?.message ?? 'internal error' });
  }
}
