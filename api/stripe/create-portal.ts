// api/stripe/create-portal.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const STRIPE_API_KEY = process.env.STRIPE_API_KEY!;
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // --- 認証（Bearer トークンで Supabase ユーザー特定）
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: userInfo, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userInfo?.user) return res.status(401).json({ error: 'Invalid token' });

    const uid = userInfo.user.id;
    const email = userInfo.user.email || undefined;

    // --- users テーブルから行を取得（※カラム名は id！）
    const { data: row, error: selErr } = await admin
      .from('users')
      .select('id, email, stripe_customer_id')
      .eq('id', uid)
      .single();

    if (selErr) return res.status(500).json({ error: 'DB select failed', detail: selErr.message });

    // --- Stripe カスタマー確保（なければ作成して保存）
    let customerId = row?.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: row?.email ?? email,
        metadata: { app_uid: uid },
      });
      customerId = customer.id;

      const { error: updErr } = await admin
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', uid);
      if (updErr) return res.status(500).json({ error: 'DB update failed', detail: updErr.message });
    }

    // --- ポータルセッション作成
    const baseUrl = NEXT_PUBLIC_APP_URL || (req.headers.origin as string) || 'https://example.com';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/`,
      // 機能の細かな有効化はダッシュボード側設定に依存
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: e?.message || String(e) });
  }
}
