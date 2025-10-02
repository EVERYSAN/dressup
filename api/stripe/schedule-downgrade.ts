// /api/stripe/schedule-downgrade.ts
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// ==== env ====
const STRIPE_KEY = process.env.STRIPE_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY!;
const PRICE_LIGHT = process.env.STRIPE_PRICE_LIGHT!;
const PRICE_BASIC = process.env.STRIPE_PRICE_BASIC!;
const PRICE_PRO   = process.env.STRIPE_PRICE_PRO!;

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' }); // ← 型と合わせる

// ==== helpers ====
type Tier = 'free'|'light'|'basic'|'pro';
const priceToTier: Record<string, Tier> = {
  [PRICE_LIGHT]: 'light',
  [PRICE_BASIC]: 'basic',
  [PRICE_PRO]:   'pro',
};
const tierOrder: Record<Tier, number> = { free:0, light:1, basic:2, pro:3 };

function assertLower(current: Tier, next: Tier) {
  if (tierOrder[next] >= tierOrder[current]) {
    throw new Error('Only downgrades are allowed here.');
  }
}

async function getUserFromJWT(req: any) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new Error('Missing bearer token');

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${m[1]}` } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Invalid session');
  return user;
}

// ==== handler ====
export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await getUserFromJWT(req);

    // 文字列で届いた時の保険
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { targetPlan, targetPriceId } = body as { targetPlan?: Tier; targetPriceId?: string };

    const targetPrice =
      targetPriceId ??
      (targetPlan === 'light' ? PRICE_LIGHT :
       targetPlan === 'basic' ? PRICE_BASIC :
       targetPlan === 'pro'   ? PRICE_PRO   : undefined);

    if (!targetPrice) return res.status(400).json({ error: 'Bad request: target plan/price required' });

    const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: urow, error: uerr } = await admin
      .from('users')
      .select('id,email,stripe_customer_id,plan')
      .eq('id', user.id)
      .single();
    if (uerr || !urow?.stripe_customer_id) throw new Error('No stripe_customer_id linked');

    // 現行サブスク
    const list = await stripe.subscriptions.list({
      customer: urow.stripe_customer_id,
      status: 'active',
      expand: ['data.items.data.price'],
      limit: 1,
    });
    const sub = list.data[0];
    if (!sub) throw new Error('Active subscription not found');

    const currentPriceId = sub.items.data[0]?.price?.id;
    const currentTier = currentPriceId ? (priceToTier[currentPriceId] ?? 'free') : 'free';
    const nextTier    = priceToTier[targetPrice] ?? 'free';

    // ダウングレードのみ許可
    assertLower(currentTier, nextTier);

    // 既存スケジュール（重複防止）
    const schedList = await stripe.subscriptionSchedules.list({
      customer: urow.stripe_customer_id,
      limit: 10,
      expand: ['data.phases.items.price'],
    });
    const existing = schedList.data.find(s => s.subscription === sub.id && s.status !== 'canceled');
    if (existing) {
      return res.status(200).json({ ok: true, scheduled: true, scheduleId: existing.id });
    }

    // 期末にだけ下げる
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: sub.id,
      phases: [
        {
          // 現行プラン維持フェーズ
          items: sub.items.data.map(i => ({ price: i.price.id, quantity: i.quantity ?? 1 })),
          end_date: sub.current_period_end,      // ← 期末で終了
          proration_behavior: 'none',            // ← 日割りなし（型OK位置）
        },
        {
          // 次期から targetPrice
          items: [{ price: targetPrice, quantity: 1 }],
          proration_behavior: 'none',
        },
      ],
    }, {
      idempotencyKey: `sched-dg-${sub.id}-${targetPrice}`,
    });

    return res.status(200).json({ ok: true, scheduled: true, scheduleId: schedule.id });
  } catch (e: any) {
    console.error('[schedule-downgrade] failed:', e);
    return res.status(500).json({ error: 'Server error', detail: e?.message ?? String(e) });
  }
}
