// api/stripe/create-checkout.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STRIPE_API_KEY = process.env.STRIPE_API_KEY!;
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const PRICE_LIGHT = process.env.STRIPE_PRICE_LIGHT!;
const PRICE_BASIC = process.env.STRIPE_PRICE_BASIC!;
const PRICE_PRO   = process.env.STRIPE_PRICE_PRO!;

const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });

// 既存IDが無効（モード不一致など）なら新規作成し DB を更新
async function ensureCustomer(
  stripe: Stripe,
  admin: SupabaseClient<any, any, any> | any,
  uid: string,
  email?: string | null,
  existingId?: string | null
): Promise<string> {
  if (existingId) {
    try {
      const c = await stripe.customers.retrieve(existingId);
      if (!('deleted' in c && c.deleted)) return existingId;
    } catch {
      // resource_missing 等は作り直しへ
    }
  }
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { app_uid: uid },
  });
  await (admin as any)
    .from('users')
    .update({ stripe_customer_id: customer.id } as any)
    .eq('id', uid);
  return customer.id;
}

const planToPrice = (plan: string) => {
  switch (plan) {
    case 'light': return PRICE_LIGHT;
    case 'basic': return PRICE_BASIC;
    case 'pro':   return PRICE_PRO;
    default:      return null;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { plan } = (req.body ?? {}) as { plan?: 'light' | 'basic' | 'pro' };
    const price = planToPrice(plan || '');
    if (!price) return res.status(400).json({ error: 'Invalid plan' });

    // 認証
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    // Supabase (Service Role)
    const admin: SupabaseClient<any, any, any> = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
    const { data: userInfo, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userInfo?.user) return res.status(401).json({ error: 'Invalid token' });

    const uid = userInfo.user.id;
    const email = userInfo.user.email || undefined;

    // 自分の users 行
    const { data: row, error: selErr } = await admin
      .from('users')
      .select('id, email, stripe_customer_id')
      .eq('id', uid)
      .single();
    if (selErr) return res.status(500).json({ error: 'DB select failed', detail: selErr.message });

    // 顧客IDを確定（モード不一致は自己修復）
    const customerId = await ensureCustomer(stripe, admin, uid, row?.email ?? email, row?.stripe_customer_id);

    // 戻りURL
    const baseUrl =
      NEXT_PUBLIC_APP_URL ||
      (req.headers.origin as string) ||
      (req.headers.host ? `https://${req.headers.host}` : 'https://www.dressupai.app');

    // Checkout セッション
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancel`,
      metadata: { uid, plan: plan! },
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[create-checkout] error:', e?.message || e);
    return res.status(500).json({ error: 'Server error', detail: e?.message || String(e) });
  }
}
