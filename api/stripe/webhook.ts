// api/stripe/webhook.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import getRawBody from 'raw-body';
import { createClient } from '@supabase/supabase-js';

// 署名検証は raw body が必須
export const config = { api: { bodyParser: false } };

// ---- Stripe / Supabase 初期化 ----
const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: '2024-06-20',
});
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- Price → プラン/付与回数 マップ（※各環境の Price ID を env から）----
const PRICE_LIGHT = process.env.STRIPE_PRICE_LIGHT!;
const PRICE_BASIC = process.env.STRIPE_PRICE_BASIC!;
const PRICE_PRO   = process.env.STRIPE_PRICE_PRO!;

type Plan = 'free' | 'light' | 'basic' | 'pro';
function mapPrice(priceId: string): { plan: Plan; credits: number } | null {
  switch (priceId) {
    case PRICE_LIGHT: return { plan: 'light', credits: 100 };
    case PRICE_BASIC: return { plan: 'basic', credits: 500 };
    case PRICE_PRO:   return { plan: 'pro',   credits: 1200 };
    default: return null;
  }
}
const FREE_CREDITS = 10;

// ---- ユーザー更新（stripe_customer_id で1行更新）----
async function setUserPlanByCustomer(
  customerId: string,
  plan: Plan,
  creditsTotal: number,
  periodEnd?: number | null,
) {
  const { error } = await admin
    .from('users')
    .update({
      plan,
      credits_total: creditsTotal,
      credits_used: 0,
      period_end: periodEnd ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);

  if (error) throw new Error(`DB update failed: ${error.message}`);
}

// ---- 価格IDの取得を“必ず成功”させるためのヘルパー ----
async function getSubscriptionPriceId(subOrId: string | Stripe.Subscription) {
  const sub =
    typeof subOrId === 'string'
      ? await stripe.subscriptions.retrieve(subOrId)
      : subOrId;

  // 先頭アイテムの price.id を採用（単一価格の想定）
  return sub.items.data[0]?.price?.id || '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ---- Stripe 署名検証（raw body 必須）----
  let event: Stripe.Event;
  try {
    const raw = (await getRawBody(req)).toString('utf8');
    const sig = req.headers['stripe-signature'] as string;
    event = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('[webhook] signature verify failed:', err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message ?? 'invalid signature'}`);
  }

  try {
    switch (event.type) {
      // 1) Checkout完了。サブスクの subscription を取り直して price.id を確定
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription && session.customer) {
          const priceId = await getSubscriptionPriceId(session.subscription);
          const map = mapPrice(priceId);
          if (map) {
            await setUserPlanByCustomer(String(session.customer), map.plan, map.credits,
              (typeof session.subscription === 'string'
                ? (await stripe.subscriptions.retrieve(session.subscription)).current_period_end
                : session.subscription.current_period_end)
            );
          } else {
            console.warn('[webhook] unknown price on checkout.session.completed:', priceId);
          }
        }
        break;
      }

      // 2) サブスク作成/更新。こちらでも常に反映して冪等化
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.customer) {
          const priceId = await getSubscriptionPriceId(sub);
          const map = mapPrice(priceId);
          // cancel_at_period_end のときはプランを即 free にしない（期末まで有効）
          // ここでは period_end だけ更新する等、軽い反映に留める
          if (map && ['active','trialing','past_due','unpaid'].includes(sub.status)) {
            await admin.from('users')
              .update({
                // plan は反映してもOK（UI で「解約予定」表示ができる）
                plan: map.plan,
                period_end: sub.current_period_end,
                updated_at: new Date().toISOString(),
              })
              .eq('stripe_customer_id', String(sub.customer));
          }
        }
        break;
      }

      // 3) 請求成功（更新課金時など）。ここでもリセット/延長を確実に
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.subscription && inv.customer) {
          const sub = await stripe.subscriptions.retrieve(
            typeof inv.subscription === 'string' ? inv.subscription : inv.subscription.id
          );
          const priceId = (sub.items.data[0]?.price?.id) || '';
          const map = mapPrice(priceId);
          if (map) {
            await setUserPlanByCustomer(String(inv.customer), map.plan, map.credits, sub.current_period_end);
            // setUserPlanByCustomer は credits_used=0 を行う実装のままでOK
          }
        }
        break;
      }

      // 4) 解約・失効 → free に戻す
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.customer) {
          await setUserPlanByCustomer(String(sub.customer), 'free', FREE_CREDITS, null);
        }
        break;
      }

      default:
        // ハンドリングしないイベントは 200 でOK
        break;
    }

    return res.status(200).json({ received: true });
  } catch (e: any) {
    console.error('[webhook] handler error:', e?.message || e);
    return res.status(500).json({ error: 'webhook failed', detail: String(e?.message || e) });
  }
}
