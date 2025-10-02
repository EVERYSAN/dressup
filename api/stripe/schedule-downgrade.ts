// /api/stripe/schedule-downgrade.ts
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const STRIPE_KEY = process.env.STRIPE_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const PRICE_LIGHT = process.env.STRIPE_PRICE_LIGHT!;
const PRICE_BASIC = process.env.STRIPE_PRICE_BASIC!;
const PRICE_PRO   = process.env.STRIPE_PRICE_PRO!;

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });

type Tier = 'free'|'light'|'basic'|'pro';
const priceToTier: Record<string, Tier> = {
  [PRICE_LIGHT]: 'light',
  [PRICE_BASIC]: 'basic',
  [PRICE_PRO]:   'pro',
};
const tierOrder: Record<Tier, number> = { free:0, light:1, basic:2, pro:3 };

function assertLower(current: Tier, next: Tier) {
  if (tierOrder[next] >= tierOrder[current]) {
    const err = new Error('Only downgrades are allowed here.');
    (err as any).status = 400;
    throw err;
  }
}

// JWT から現在ユーザーを引く（フロントの Bearer を使用）
async function getUserFromJWT(req: any) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) {
    const err = new Error('Missing bearer token');
    (err as any).status = 401;
    throw err;
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${m[1]}` } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    const err = new Error('Invalid session');
    (err as any).status = 401;
    throw err;
  }
  return user;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await getUserFromJWT(req);

    // 文字列/JSON 両対応
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { plan, targetPlan, priceId, targetPriceId } = raw as {
      plan?: 'light'|'basic'|'pro';
      targetPlan?: 'light'|'basic'|'pro';
      priceId?: string;
      targetPriceId?: string;
    };

    const chosenPlan = plan ?? targetPlan;

    const targetPrice =
      priceId ??
      targetPriceId ??
      (chosenPlan === 'light' ? PRICE_LIGHT
       : chosenPlan === 'basic' ? PRICE_BASIC
       : chosenPlan === 'pro'   ? PRICE_PRO
       : undefined);

    if (!targetPrice) {
      return res.status(400).json({ error: 'Bad request', detail: 'target plan/price required' });
    }

    console.log('[schedule-downgrade] req.body =', { plan, targetPlan, priceId, targetPriceId, chosenPlan, targetPrice });

    // users を service_role で読む（RLS越え）
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: urow, error: uerr } = await admin
      .from('users')
      .select('id,email,stripe_customer_id,plan')
      .eq('id', user.id)
      .single();
    if (uerr) {
      const err = new Error(`Supabase users read failed: ${uerr.message}`);
      (err as any).status = 500;
      throw err;
    }
    if (!urow?.stripe_customer_id) {
      const err = new Error('No stripe_customer_id linked to this user');
      (err as any).status = 400;
      throw err;
    }

    // 現行サブスクリプション（active or trialing を優先）
    const list = await stripe.subscriptions.list({
      customer: urow.stripe_customer_id,
      status: 'all',
      expand: ['data.items.data.price'],
      limit: 10,
    });

    const sub = list.data.find(s => s.status === 'active' || s.status === 'trialing')
            ?? list.data.find(s => s.status === 'past_due');
    if (!sub) {
      const err = new Error('Active subscription not found');
      (err as any).status = 400;
      throw err;
    }

    const currentPriceId = sub.items.data[0]?.price?.id;
    const currentTier: Tier = currentPriceId ? (priceToTier[currentPriceId] ?? 'free') : 'free';
    const nextTier: Tier    = priceToTier[targetPrice] ?? 'free';

    // ダウングレードのみ許可
    assertLower(currentTier, nextTier);

    // 既存スケジュールがある場合は重複作成しない
    const schedList = await stripe.subscriptionSchedules.list({
      customer: urow.stripe_customer_id,
      limit: 10,
      expand: ['data.phases.items.price'],
    });
    const existing = schedList.data.find(s => s.subscription === sub.id && s.status !== 'canceled');
    if (existing) {
      console.log('[schedule-downgrade] schedule already exists:', existing.id);
      return res.status(200).json({ ok: true, scheduled: true, scheduleId: existing.id });
    }

    // (A) from_subscription だけでまず作成（※この時点では phases を渡さない）
    const created = await stripe.subscriptionSchedules.create(
      { from_subscription: sub.id },
      { idempotencyKey: `sched-dg-${sub.id}-${targetPrice}-create` }
    );

    // (B) phases を update で設定（期末で現行→次期から targetPrice）
    const updated = await stripe.subscriptionSchedules.update(
      created.id,
      {
        phases: [
          {
            items: sub.items.data.map(i => ({ price: i.price.id, quantity: i.quantity ?? 1 })),
            end_date: sub.current_period_end, // 期末まで現行プラン
          },
          {
            items: [{ price: targetPrice, quantity: 1 }], // 次期からダウン後プラン
          },
        ],
      },
      { idempotencyKey: `sched-dg-${sub.id}-${targetPrice}-update` }
    );

    console.log('[schedule-downgrade] schedule created:', updated.id);
    return res.status(200).json({ ok: true, scheduled: true, scheduleId: updated.id });
  } catch (e: any) {
    console.error('[schedule-downgrade] failed:', {
      message: e?.message,
      type: e?.type,
      code: e?.code,
      status: e?.status,
      raw: e?.raw,
      stack: e?.stack,
    });
    // 具体的な原因を返してフロントで把握できるようにする
    const status = e?.status ?? 500;
    return res.status(status).json({
      error: status === 400 ? 'Bad request' : status === 401 ? 'Unauthorized' : 'Server error',
      detail: e?.message ?? String(e),
      type: e?.type,
      code: e?.code,
    });
  }
}
