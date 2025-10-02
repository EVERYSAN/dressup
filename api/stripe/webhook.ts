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
    default:
      console.warn('[webhook] priceId not mapped:', priceId);
      return null; // ← ここは維持（後述の ensure が先に走るのでDB行は作られる）
  }
}

const FREE_CREDITS = 10;

// ---- ユーザー更新（stripe_customer_id で1行更新）----
// webhook.ts 内の setUserPlanByCustomer を丸ごと差し替え
async function setUserPlanByCustomer(
  customerId: string,
  plan: Plan,
  creditsTotal: number,
  periodEndUnix: number | null,   // ← null 許容
) {
  // --- null / 不正値を先に弾く（TS の型絞り込み & Stripe 時刻の妥当域チェック）---
  const isValid =
    typeof periodEndUnix === 'number' &&
    Number.isFinite(periodEndUnix) &&
    periodEndUnix >= 946684800 &&      // 2000-01-01
    periodEndUnix <  4102444799;       // 2100-01-01

  if (!isValid) {
    console.warn('[webhook] period_end looks invalid, keep NULL:', periodEndUnix);
  }
  const safePeriodEnd = isValid ? periodEndUnix : null;

  const { error } = await admin
    .from('users')
    .update({
      plan,
      credits_total: creditsTotal,
      credits_used: 0,
      period_end: safePeriodEnd,                 // ← 常に安全な値だけ反映
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);

  if (error) throw new Error(`DB update failed: ${error.message}`);
}



// 既存の ensureUserLinkedToCustomer を置き換え
async function ensureUserLinkedToCustomer(params: { customerId: string; emailHint: string | null }) {
  const { customerId, emailHint } = params;
  if (!customerId) return;

  // 1) email があれば「新規だけ」作る（既存は DO NOTHING）
  if (emailHint) {
    const { error: insErr } = await admin
      .from('users')
      .upsert(
        {
          email: emailHint,
          // 既存を壊さないため初期値は“新規時だけ”入れたい → ignoreDuplicates:true で DO NOTHING に
          plan: 'free',
          credits_total: 10,
          credits_used: 0,
          period_end: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'email', ignoreDuplicates: true }
      );
    if (insErr) console.error('[webhook] ensure upsert(insert) failed:', insErr);

    // 2) 既存行がある場合でも、stripe_customer_id が未設定ならだけ埋める
    const { error: updErr } = await admin
      .from('users')
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq('email', emailHint)
      .is('stripe_customer_id', null); // ← ここが「未設定ならだけ」
    if (updErr) console.error('[webhook] ensure set customerId failed:', updErr);

    return;
  }

  // email がない場合は既存にタッチだけ（新規作成はしない）
  const { error: touchErr } = await admin
    .from('users')
    .update({ updated_at: new Date().toISOString() })
    .eq('stripe_customer_id', customerId);
  if (touchErr) console.error('[webhook] touch by customerId failed:', touchErr);
}


// どこかユーティリティ群の下に
function pickPeriodEndFromInvoice(inv: Stripe.Invoice): number | null {
  // まず subscription.current_period_end を試みる
  let periodEnd: number | null = null;

  // 呼び出し側ですでに sub を取っていない場合は lines を信頼する
  const line = inv.lines?.data?.[0];
  if (line?.period?.end) {
    periodEnd = line.period.end;           // ← ここが一番確実（UNIX秒）
  }
  return periodEnd;
}



// ---- 価格IDの取得を“必ず成功”させるためのヘルパー ----
async function getSubscriptionPriceId(subOrId: string | Stripe.Subscription) {
  const sub =
    typeof subOrId === 'string'
      ? await stripe.subscriptions.retrieve(subOrId)
      : subOrId;

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

            // 🔽 Checkout経由でも念のため自己修復（email は session 側にもあることが多い）
        await ensureUserLinkedToCustomer({
          customerId: String(session.customer),
          emailHint: session.customer_details?.email ?? null,
        });
        const priceId = await getSubscriptionPriceId(session.subscription);
        const map = mapPrice(priceId);
        if (map) {
          const sub = typeof session.subscription === 'string'
            ? await stripe.subscriptions.retrieve(session.subscription)
            : session.subscription;
          await setUserPlanByCustomer(String(session.customer), map.plan, map.credits, sub.current_period_end ?? null);
        } else {
          console.warn('[webhook] unknown price on checkout.session.completed:', priceId);
        }
      }
      break;
    }
    
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.customer) {
        
        const cust = await stripe.customers.retrieve(String(sub.customer)) as Stripe.Customer;
        await ensureUserLinkedToCustomer({
          customerId: String(sub.customer),
          emailHint: cust.email ?? null,
        });
        const priceId = await getSubscriptionPriceId(sub);
        const map = mapPrice(priceId);
        // 期末解約(cancel_at_period_end)でも、ここでは period_end を更新しておく
        if (map && ['active','trialing','past_due','unpaid'].includes(sub.status)) {
          const { error: updErr } = await admin.from('users')
            .update({
              plan: map.plan,
              credits_total: map.credits,   // ★ これを追加（プランに応じた総枠に）
              credits_used: 0,              // ★ サイクル開始時は安全のためリセット
              period_end: sub.current_period_end,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_customer_id', String(sub.customer));
        
          if (updErr) console.error('[webhook] sub.upd users.update failed:', updErr);
        }
      }
      break;
    }
    
    case 'invoice.payment_succeeded': {
      const inv = event.data.object as Stripe.Invoice;
      if (!inv.subscription || !inv.customer) break;
    
      // ユーザー自己修復（既存のまま）
      await ensureUserLinkedToCustomer({
        customerId: String(inv.customer),
        emailHint: inv.customer_email ?? null,
      });
    
      // price は lines から拾うのが確実
      const line = inv.lines?.data?.[0];
      const priceId = line?.price?.id ?? '';
      const mapped = mapPrice(priceId);
    
      // ← ここがポイント：lines.period.end を採用
      const periodEnd = pickPeriodEndFromInvoice(inv);
    
      console.log('[webhook] invoice.succeeded',
        { priceId, mapped, periodEnd });
    
      if (mapped) {
        await setUserPlanByCustomer(
          String(inv.customer),
          mapped.plan,
          mapped.credits,
          periodEnd // null なら setUserPlanByCustomer 側で null 保存
        );
      } else {
        console.warn('[webhook] skip plan update due to unmapped price:', priceId);
      }
      break;
    }



    
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
