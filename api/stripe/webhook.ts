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
async function setUserPlanByCustomer(
  customerId: string,
  plan: Plan,
  creditsTotal: number,
  periodEndUnix: number // ← 必須 & 秒
) {
  // 妥当性チェック（2000-01-01〜2100-01-01 の範囲に収まるか）
  if (
    !Number.isFinite(periodEndUnix) ||
    periodEndUnix < 946684800 ||          // 2000-01-01
    periodEndUnix >= 4102444799           // 2100-01-01
  ) {
    console.warn('period_end looks invalid, keep previous or set NULL:', periodEndUnix);
  }

  const { error } = await admin
    .from('users')
    .update({
      plan,
      credits_total: creditsTotal,
      credits_used: 0,           // 課金成功時はリセット
      period_end: Number.isFinite(periodEndUnix) ? periodEndUnix : null, // int8 に秒で保存
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);

  if (error) throw new Error(`DB update failed: ${error.message}`);
}


// webhook.ts の先頭ユーティリティ群の近くに追加
async function ensureUserLinkedToCustomer(params: { customerId: string; emailHint: string | null }) {
  const { customerId, emailHint } = params;
  if (!customerId) return;

  // 1) すでに customerId で紐づいていれば何もしない
  const { data: byCustomer, error: sel1 } = await admin
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (sel1) {
    console.error('[webhook] select by customer failed:', sel1);
    return;
  }
  if (byCustomer) return;

  // 2) email で既存行があれば stripe_customer_id を埋める
  if (emailHint) {
    const { data: byEmail, error: sel2 } = await admin
      .from('users')
      .select('id')
      .eq('email', emailHint)
      .maybeSingle();
    if (sel2) {
      console.error('[webhook] select by email failed:', sel2);
      return;
    }
    if (byEmail) {
      const { error: upd } = await admin
        .from('users')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('id', byEmail.id);
      if (upd) console.error('[webhook] update existing user failed:', upd);
      return;
    }
  } else {
    console.warn('[webhook] no emailHint; cannot create new user. customerId=', customerId);
    return;
  }

  // 3) 行が無ければ新規作成（NOT NULL を満たすデフォルトも入れる）
  const { error: insErr } = await admin.from('users').insert({
    email: emailHint,
    stripe_customer_id: customerId,
    plan: 'free',
    credits_total: 10,
    credits_used: 0,
    period_end: null,
    updated_at: new Date().toISOString(),
  });
  if (insErr) console.error('[webhook] insert user failed:', insErr);
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
          await setUserPlanByCustomer(String(session.customer), map.plan, map.credits, sub.current_period_end);
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
    
      // 1) ダッシュボード作成にも耐える自己修復
      await ensureUserLinkedToCustomer({
        customerId: String(inv.customer),
        emailHint: inv.customer_email ?? null,
      });
    
      // 2) period_end を二段で取得（まず Subscription、だめなら Invoice line）
      let periodEnd: number | null = null;
      try {
        const sub = await stripe.subscriptions.retrieve(
          typeof inv.subscription === 'string'
            ? inv.subscription
            : inv.subscription.id
        );
        periodEnd = sub.current_period_end ?? null;
    
        // priceId も subscription 由来だと取りこぼす場合があるため、lines 由来を優先
        // （この後 lines 側で改めて拾うのでここではログだけでもOK）
        console.log('[webhook] sub.current_period_end=', sub.current_period_end);
      } catch (e) {
        console.warn('[webhook] subscriptions.retrieve failed:', e);
      }
    
      // Invoice の明細からも拾う（こちらの方が確実）
      const line = inv.lines?.data?.[0];
      const fallbackEnd = line?.period?.end; // UNIX秒
      if (!periodEnd && typeof fallbackEnd === 'number') {
        periodEnd = fallbackEnd;
      }
    
      // 3) 価格IDは lines から（subscription.items より確実）
      const priceId = line?.price?.id ?? '';
      const mapped = mapPrice(priceId);
    
      console.log('[webhook] invoice.succeeded priceId=', priceId, 'mapped=', mapped, 'periodEnd=', periodEnd);
    
      if (mapped) {
        await setUserPlanByCustomer(
          String(inv.customer),
          mapped.plan,
          mapped.credits,
          periodEnd ?? null        // ← ここに最終値を渡す
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
