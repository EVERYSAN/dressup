// api/stripe/webhook.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import getRawBody from 'raw-body';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: '2024-06-20',
});
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ★ 価格ID → プラン名・付与回数 の対応
const PRICE_TO_PLAN: Record<string, { plan: 'light'|'basic'|'pro'; credits: number }> = {
  [process.env.STRIPE_PRICE_LIGHT!]: { plan: 'light', credits: 50  },   // 月50回
  [process.env.STRIPE_PRICE_BASIC!]: { plan: 'basic', credits: 100 },   // 月100回
  [process.env.STRIPE_PRICE_PRO!]:   { plan: 'pro',   credits: 300 },   // 月300回
};

// free解約時の既定回数
const FREE_CREDITS = 10;

async function upsertUserPlanById({
  userId,
  email,
  plan,
  creditsTotal,
}: {
  userId: string;
  email?: string | null;
  plan: 'free'|'light'|'basic'|'pro';
  creditsTotal: number;
}) {
  // users.id 基準で upsert
  const { error } = await supa
    .from('users')
    .upsert(
      {
        id: userId,
        email: email ?? undefined,
        plan,
        credits_total: creditsTotal,
      },
      { onConflict: 'id' }
    );

  if (error) {
    console.error('[webhook] upsert users failed', error);
    throw new Error(error.message);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Stripe 署名検証には raw body が必須
  let event: Stripe.Event;
  try {
    const rawBody = (await getRawBody(req)).toString('utf8');
    const signature = req.headers['stripe-signature'] as string;
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('[webhook] signature verify failed', err?.message || err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        // ここで metadata.user_id を使ってアプリのユーザーと結びつける
        const userId = (session.metadata?.user_id as string) || '';
        const priceId = session?.line_items?.data?.[0]?.price?.id // 拡張されている場合
          || (session.metadata?.price_id as string)               // 自分で入れた場合
          || '';

        if (!userId) {
          console.warn('[webhook] no metadata.user_id on session');
          break;
        }

        // 価格ID → プランに変換
        const planInfo = PRICE_TO_PLAN[priceId];
        if (!planInfo) {
          console.warn('[webhook] unknown price id', priceId);
          break;
        }

        await upsertUserPlanById({
          userId,
          email: session.customer_details?.email ?? null,
          plan: planInfo.plan,
          creditsTotal: planInfo.credits,
        });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;

        // ユーザーIDは Checkout 作成時に metadata に同梱しておくのが王道
        const userId = (sub.metadata?.user_id as string) || '';
        if (!userId) {
          console.warn('[webhook] no metadata.user_id on subscription.updated');
          break;
        }

        // アクティブな最上位価格を拾う
        const priceId =
          (sub.items?.data?.[0]?.price?.id as string) || '';

        // ステータスに応じた処理
        if (sub.status === 'active' || sub.status === 'trialing') {
          const planInfo = PRICE_TO_PLAN[priceId];
          if (planInfo) {
            await upsertUserPlanById({
              userId,
              plan: planInfo.plan,
              creditsTotal: planInfo.credits,
              email: undefined,
            });
          }
        } else if (
          sub.status === 'canceled' ||
          sub.status === 'incomplete_expired' ||
          sub.status === 'unpaid' ||
          sub.status === 'past_due'
        ) {
          // free に落とす
          await upsertUserPlanById({
            userId,
            plan: 'free',
            creditsTotal: FREE_CREDITS,
            email: undefined,
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata?.user_id as string) || '';
        if (!userId) break;

        await upsertUserPlanById({
          userId,
          plan: 'free',
          creditsTotal: FREE_CREDITS,
          email: undefined,
        });
        break;
      }

      default:
        // 使わないイベントは 200 で OK
        break;
    }

    return res.status(200).json({ received: true });
  } catch (e: any) {
    console.error('[webhook] handler error', e?.message || e);
    return res.status(500).json({ error: 'webhook failed', detail: String(e?.message || e) });
  }
}
