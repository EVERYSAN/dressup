// api/stripe/create-portal.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient , SupabaseClient  } from '@supabase/supabase-js';

const STRIPE_API_KEY = process.env.STRIPE_API_KEY!;
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });

// --- CORS（プリフライトを許可）
function withCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

// 既存のIDが別モード等で無効なら作り直してDB保存
async function ensureCustomer(
  admin: SupabaseClient<any, any, any> | any,
  uid: string,
  email?: string | null,
  existingId?: string | null
): Promise<string> {
  if (existingId) {
    try {
      const c = await stripe.customers.retrieve(existingId);
      if (!('deleted' in c && c.deleted)) return existingId;
    } catch (e: any) {
      // resource_missing 等 → 作り直しへ
      console.warn('[portal] invalid customer on this mode:', existingId, e?.message);
    }
  }
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { app_uid: uid },
  });
  const { error: updErr } = await (admin as any)
    .from('users')
    .update({ stripe_customer_id: customer.id } as any)
    .eq('id', uid);
  if (updErr) throw new Error(`DB update failed: ${updErr.message}`);
  return customer.id;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // --- 認証（Bearer）
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const admin: SupabaseClient<any, any, any> = createClient(
     SUPABASE_URL,
     SERVICE_ROLE_KEY,
     { auth: { persistSession: false } }
    );
    const { data: userInfo, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userInfo?.user) return res.status(401).json({ error: 'Invalid token' });

    const uid = userInfo.user.id;
    const email = userInfo.user.email || undefined;

    // --- users 取得
    const { data: row, error: selErr } = await admin
      .from('users')
      .select('id, email, stripe_customer_id')
      .eq('id', uid)
      .single();
    if (selErr) return res.status(500).json({ error: 'DB select failed', detail: selErr.message });

    // --- 顧客IDを確定（モード不一致も自己修復）
    const customerId = await ensureCustomer(admin, uid, row?.email ?? email, row?.stripe_customer_id);

    // --- return_url（Header が ?portal=return をトリガに再フェッチする）
    const base =
      NEXT_PUBLIC_APP_URL ||
      (req.headers.origin as string) ||
      (req.headers.host ? `https://${req.headers.host}` : 'https://www.dressupai.app');
    const returnUrl = `${base}/?portal=return`;

    // --- Portal セッション
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      // 詳細の表示/機能はダッシュボード側の Portal 設定に従う
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[portal] error:', e?.message || e);
    // Stripe のエラーなら detail をそのまま返す
    if (e && e.type && typeof e.type === 'string') {
      return res.status(500).json({ error: 'Stripe error', detail: e.message });
    }
    return res.status(500).json({ error: 'Server error', detail: e?.message || String(e) });
  }
}
