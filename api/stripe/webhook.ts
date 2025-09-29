// /api/stripe/webhook.ts
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: '2024-06-20',
});

// Service Role で RLS 越え更新
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 価格ID → { plan, limit } のマップ
const priceToQuota = new Map<string, { plan: string; limit: number }>([
  [process.env.STRIPE_PRICE_LIGHT!, { plan: 'light', limit: 50 }],
  [process.env.STRIPE_PRICE_BASIC!, { plan: 'basic', limit: 100 }],
  [process.env.STRIPE_PRICE_PRO!  , { plan: 'pro',   limit: 300 }],
]);

export default async function handler(req: Request) {
  // Stripe署名検証のため、JSONにせず raw ボディを使う
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return new Response('Missing signature or secret', { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error('Webhook signature verification failed', err?.message);
    return new Response(`Webhook Error: ${err?.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      // 1) 初回購入・チェックアウト完了
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = (session.metadata as any)?.user_id as string | undefined;

        // 価格IDを取り出す（line_items なしのことがあるので、必要なら expand して再取得）
        let priceId: string | undefined;

        // まずは簡易に subscription から
        if (!priceId && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          priceId = sub.items.data[0]?.price?.id;
        }

        // それでも無ければ line_items を expand
        if (!priceId) {
          const full = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ['line_items'],
          });
          priceId = full.line_items?.data?.[0]?.price?.id;
        }

        if (!userId || !priceId) {
          console.warn('missing userId or priceId');
          break;
        }

        const entry = priceToQuota.get(priceId);
        if (!entry) {
          console.warn('price not mapped', priceId);
          break;
        }

        // プラン反映 + 当月は使用回数リセット
        const { error } = await supabaseAdmin
          .from('app_users')
          .update({
            plan: entry.plan,
            quota_limit: entry.limit,
            quota_used: 0,
            quota_period_start: new Date().toISOString().slice(0, 10),
          })
          .eq('user_id', userId);

        if (error) throw error;
        break;
      }

      // 2) 毎月の請求が支払われたタイミングで回数リセットしたい場合（任意）
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string | undefined;
        if (!subId) break;

        // サブスクから customer を得て → そこからメタデータや price を辿る
        const sub = await stripe.subscriptions.retrieve(subId);
        const priceId = sub.items.data[0]?.price?.id;
        const entry = priceToQuota.get(priceId ?? '');
        if (!entry) break;

        // どの user_id か？ … 初回 checkout.session の metadata.user_id を
        // customer の metadata にコピーしておくと取りやすいです。
        const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        const userId = (customer.metadata as any)?.user_id as string | undefined;
        if (!userId) break;

        const { error } = await supabaseAdmin
          .from('app_users')
          .update({
            plan: entry.plan,
            quota_limit: entry.limit,
            quota_used: 0,
            quota_period_start: new Date().toISOString().slice(0, 10),
          })
          .eq('user_id', userId);

        if (error) throw error;
        break;
      }

      default:
        // 他のイベントはログだけ
        // console.log(`Unhandled event type ${event.type}`);
        break;
    }

    return new Response('OK', { status: 200 });
  } catch (err: any) {
    console.error('Webhook handler failed', err);
    return new Response('Webhook handler error', { status: 500 });
  }
}
