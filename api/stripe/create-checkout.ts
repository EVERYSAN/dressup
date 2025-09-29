// api/stripe/create-checkout.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

// ■ Stripe サーバーキー（公開鍵 pk_ では動きません）
const STRIPE_API_KEY = process.env.STRIPE_API_KEY || '';
// ■ 各プランの Price ID（Dashboard の “価格” の ID）
const PRICE_LIGHT  = process.env.STRIPE_PRICE_LIGHT  || '';
const PRICE_BASIC  = process.env.STRIPE_PRICE_BASIC  || '';
const PRICE_PRO    = process.env.STRIPE_PRICE_PRO    || '';
// ■ フロントの URL（成功/キャンセル遷移先）
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL ?? '';

const stripe = new Stripe(STRIPE_API_KEY, {
  // Stripe の型エラーを避けるための API バージョン指定
  apiVersion: '2024-06-20',
});

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

    // ここで body を JSON として読む（Vercel は既にパース済みのことが多い）
    const body = (typeof req.body === 'string') ? JSON.parse(req.body) : req.body || {};
    const plan: Plan | undefined = body?.plan;

    if (!plan || !['light','basic','pro'].includes(plan)) {
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

    // 失敗時の戻り先（ホームに戻すなど）
    const successUrl = `${APP_URL || 'https://dressupai.app'}/?checkout=success`;
    const cancelUrl  = `${APP_URL || 'https://dressupai.app'}/?checkout=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url : cancelUrl,
      // ここでメタデータにプラン名等を乗せると後段の Webhook で扱いやすいです
      metadata: { plan },
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url });
  } catch (err: any) {
    // どんなエラーでも 200 を返さず、理由を JSON で返す
    console.error('[create-checkout] error:', err);
    res.status(500).json({
      error: 'create-checkout failed',
      message: err?.message ?? String(err),
    });
  }
}
