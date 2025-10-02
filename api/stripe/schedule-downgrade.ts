// /api/stripe/schedule-downgrade.ts
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// ====== ENV ======
const STRIPE_KEY = process.env.STRIPE_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const PRICE_LIGHT = process.env.STRIPE_PRICE_LIGHT!;
const PRICE_BASIC = process.env.STRIPE_PRICE_BASIC!;
const PRICE_PRO   = process.env.STRIPE_PRICE_PRO!;

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });

// ====== UTIL ======
type Tier = 'free'|'light'|'basic'|'pro';
const priceToTier: Record<string, Tier> = {
  [PRICE_LIGHT]: 'light',
  [PRICE_BASIC]: 'basic',
  [PRICE_PRO]:   'pro',
};
const tierOrder: Record<Tier, number> = { free:0, light:1, basic:2, pro:3 };

function assertIsDowngrade(current: Tier, next: Tier) {
  if (tierOrder[next] >= tierOrder[current]) {
    const err = new Error('Only downgrades are allowed here.');
    (err as any).status = 400;
    throw err;
  }
}

// JWT → Supabase user を取得（フロントの Authorization: Bearer <session_jwt> 前提）
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

// ====== HANDLER ======
export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const user = await getUserFromJWT(req);

    // 文字列/JSON どちらでも対応
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

    console.log('[schedule-dg] body =', { plan, targetPlan, priceId, targetPriceId, chosenPlan, targetPrice });

    // users テーブルを service_role で参照（RLS越え）
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

    // 現行サブスクリプション（active/trialing を優先、なければ past_due）
    const list = await stripe.subscriptions.list({
      customer: urow.stripe_customer_id,
      status: 'all',
      expand: ['data.items.data.price'],
      limit: 10,
    });

    const sub =
      list.data.find(s => s.status === 'active' || s.status === 'trialing') ??
      list.data.find(s => s.status === 'past_due');

    if (!sub) {
      const err = new Error('Active subscription not found');
      (err as any).status = 400;
      throw err;
    }

    const currentPriceId = sub.items.data[0]?.price?.id;
    const currentTier: Tier = currentPriceId ? (priceToTier[currentPriceId] ?? 'free') : 'free';
    const nextTier: Tier    = priceToTier[targetPrice] ?? 'free';

    // ダウングレードのみ許可
    assertIsDowngrade(currentTier, nextTier);

    // 既存の未キャンセルScheduleがあれば再作成しない
    const schedList = await stripe.subscriptionSchedules.list({
      customer: urow.stripe_customer_id,
      limit: 10,
      expand: ['data.phases.items.price'],
    });
    const existing = schedList.data.find(s => s.subscription === sub.id && s.status !== 'canceled');
    if (existing) {
      console.log('[schedule-dg] existing schedule:', existing.id);
      return res.status(200).json({ ok: true, scheduled: true, scheduleId: existing.id });
    }

    // (A) まず from_subscription だけでスケジュールを作成（※この時点では phases を渡さない）
    const created = await stripe.subscriptionSchedules.create(
      { from_subscription: sub.id },
      { idempotencyKey: `sched-dg-${sub.id}-${targetPrice}-create` }
    );

    // (B) 期末（current_period_end）が null の場合があるので、安全に取得する
    let cpe: number | null = sub.current_period_end ?? null;

    // latest_invoice から period.end をフォールバックで取得（dashboard作成・API差分対策）
    if (!cpe && typeof sub.latest_invoice === 'string') {
      try {
        const inv = await stripe.invoices.retrieve(sub.latest_invoice, { expand: ['lines.data'] });
        cpe = inv?.lines?.data?.[0]?.period?.end ?? null;
      } catch (e) {
        console.warn('[schedule-dg] invoice fallback failed:', (e as any)?.message);
      }
    }

    if (!cpe || !Number.isFinite(cpe)) {
      // 期末が無いと「期末切替」が組めないので 409 を返す
      return res.status(409).json({
        error: 'Cannot determine current period end',
        detail: 'subscription.current_period_end and invoice.lines[0].period.end are both missing',
      });
    }

    // (C) phases を update で設定（★ phase1 に start_date を必ず指定するのがポイント）
    const updated = await stripe.subscriptionSchedules.update(
      created.id,
      {
        phases: [
          {
            start_date: 'now', // ★必須（これが無いと “start_date が必要” エラー）
            end_date: cpe,     // 期末まで現行プラン維持
            items: sub.items.data.map(i => ({
              price: i.price.id,
              quantity: i.quantity ?? 1,
            })),
          },
          {
            start_date: cpe,   // 期末から新プラン
            items: [{ price: targetPrice, quantity: 1 }],
          },
        ],
      },
      { idempotencyKey: `sched-dg-${sub.id}-${targetPrice}-update-v2` }
    );

    console.log('[schedule-dg] schedule created:', updated.id);
    return res.status(200).json({ ok: true, scheduled: true, scheduleId: updated.id });
  } catch (e: any) {
    console.error('[schedule-dg] failed:', {
      message: e?.message,
      type: e?.type,
      code: e?.code,
      status: e?.status,
      raw: e?.raw,
      stack: e?.stack,
    });
    const status = e?.status ?? 500;
    return res.status(status).json({
      error: status === 400 ? 'Bad request'
           : status === 401 ? 'Unauthorized'
           : status === 405 ? 'Method not allowed'
           : status === 409 ? 'Conflict'
           : 'Server error',
      detail: e?.message ?? String(e),
      type: e?.type,
      code: e?.code,
    });
  }
}
