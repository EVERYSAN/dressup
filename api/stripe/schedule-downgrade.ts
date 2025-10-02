// /api/stripe/schedule-downgrade.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// ==== env ====
const STRIPE_KEY = process.env.STRIPE_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY!; // フロントJWT検証用
const PRICE_LIGHT = process.env.STRIPE_PRICE_LIGHT!;
const PRICE_BASIC = process.env.STRIPE_PRICE_BASIC!;
const PRICE_PRO   = process.env.STRIPE_PRICE_PRO!;

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2025-08-27.basil' });

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

async function getUserFromJWT(req: NextApiRequest) {
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
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await getUserFromJWT(req);

    // 引数: targetPlan ('light' | 'basic') か targetPriceId を受ける
    const { targetPlan, targetPriceId } = req.body as { targetPlan?: Tier, targetPriceId?: string };
    const targetPrice = targetPriceId ??
      (targetPlan === 'light' ? PRICE_LIGHT :
       targetPlan === 'basic' ? PRICE_BASIC :
       targetPlan === 'pro'   ? PRICE_PRO   : undefined);
    if (!targetPrice) return res.status(400).json({ error: 'Bad request: target plan/price required' });

    // ユーザーの stripe_customer_id を取得
    const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: urow, error: uerr } = await admin
      .from('users')
      .select('id,email,stripe_customer_id,plan')
      .eq('id', user.id)
      .single();
    if (uerr || !urow?.stripe_customer_id) throw new Error('No stripe_customer_id linked');

    // 現行サブスクを取得
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

    // すでにスケジュールがあるか確認（重複回避）
    const schedList = await stripe.subscriptionSchedules.list({
      customer: urow.stripe_customer_id,
      limit: 1,
      expand: ['data.phases.items.price'],
    });
    const existingForSub = schedList.data.find(s => s.subscription === sub.id && s.status !== 'canceled');
    if (existingForSub) {
      // 既存スケジュールがあれば更新方針でもよいが、今回はそのまま情報だけ返す
      return res.status(200).json({ ok: true, scheduled: true, scheduleId: existingForSub.id });
    }

    // 期末にだけ下げる: 現行itemsを current_period_end まで → 次期から targetPrice
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: sub.id,
      proration_behavior: 'none', // 日割りしない（即時の価格調整を防止）
      phases: [
        {
          items: sub.items.data.map(i => ({ price: i.price.id, quantity: i.quantity ?? 1 })),
          end_date: sub.current_period_end, // 現行プランはここまで維持
        },
        {
          items: [{ price: targetPrice, quantity: 1 }],
          // 次期は無期限継続（iterations省略）
        },
      ],
    }, {
      idempotencyKey: `sched-dg-${sub.id}-${targetPrice}`, // 二重作成防止
    });

    return res.status(200).json({ ok: true, scheduled: true, scheduleId: schedule.id });
  } catch (e:any) {
    console.error('[schedule-downgrade] failed:', e);
    return res.status(500).json({ error: 'Server error', detail: e?.message ?? String(e) });
  }
}
