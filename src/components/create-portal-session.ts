// api/stripe/create-portal-session.ts
import type { VercelRequest, VercelResponse } from 'vercel';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: '2024-06-20', // 安定版でOK
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // フロントから送ってくる (またはサーバーで引く) Stripe 顧客ID
    const { customerId } = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {};
    if (!customerId) return res.status(400).json({ error: 'customerId required' });

    const returnUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.VITE_SUPABASE_URL || 'https://www.dressupai.app';

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      // 必要なら flow_data で「サブスク更新専用」に絞り込みも可能
      // flow_data: { type: 'subscription_update' },
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[create-portal-session] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
