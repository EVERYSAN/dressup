import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { supabaseAdmin } from '../_utils/supabase';

export const config = { api: { bodyParser: false } }; // 生ボディで受ける

const stripe = new Stripe(process.env.STRIPE_API_KEY!, { apiVersion: '2024-06-20' });

// price → plan 変換
function mapPlan(priceId?: string | null) {
  if (!priceId) return 'free';
  if (priceId === process.env.STRIPE_PRICE_BASIC) return 'basic';
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  return 'free';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  const rawBody = Buffer.concat(chunks);
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e: any) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const priceId = sub.items.data[0]?.price?.id;
        const plan = mapPlan(priceId);
        const periodEnd = sub.current_period_end;

        // customerId → user.id
        const { data: u } = await supabaseAdmin.from('users').select('id').eq('stripe_customer_id', customerId).single();
        if (u?.id) {
          // 期間が変わったらリセット（SQLの reset_credits を呼んでもOK）
          await supabaseAdmin.from('users').update({
            plan,
            period_end: periodEnd,
            credits_total: plan === 'pro' ? 500 : plan === 'basic' ? 100 : 10,
            credits_used: 0,
            updated_at: new Date().toISOString()
          }).eq('id', u.id);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const { data: u } = await supabaseAdmin.from('users').select('id').eq('stripe_customer_id', customerId).single();
        if (u?.id) {
          await supabaseAdmin.from('users').update({
            plan: 'free', credits_total: 10, credits_used: 0, period_end: null
          }).eq('id', u.id);
        }
        break;
      }
      case 'checkout.session.completed': {
        // 必要ならログ用途に
        break;
      }
    }
  } catch (e) {
    console.error(e);
    return res.status(500).end();
  }
  return res.status(200).json({ received: true });
}
