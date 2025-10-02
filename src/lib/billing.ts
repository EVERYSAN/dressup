// src/lib/billing.ts
import { supabase } from './supabaseClient';

type Plan = 'light' | 'basic' | 'pro';

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Failed to get session: ${error.message}`);
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in (no access token)');
  return token;
}

/**
 * Stripe Customer Portal を開く
 * サーバ関数 /api/stripe/create-portal は Authorization ヘッダ必須
 */
export async function openPortal(): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch('/api/stripe/create-portal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    // サーバは JSON を返すはずなので読み取ってエラー表示
    const text = await res.text();
    throw new Error(`Server responded ${res.status}: ${text}`);
  }

  const { url } = await res.json();
  if (!url) throw new Error('No portal URL in response');
  // リダイレクト
  window.location.href = url;
}

/**
 * プラン購入（Checkout）
 * /api/stripe/create-checkout へ plan を JSON で送る + Authorization 必須
 */
export async function buy(plan: Plan): Promise<void> {
  const token = await getAccessToken();

  // サーバ側(create-checkout.ts)で 'light' | 'basic' | 'pro' を受けて
  // STRIPE_PRICE_LIGHT / STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO を選んでいます。
  const res = await fetch('/api/stripe/create-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ plan }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server responded ${res.status}: ${text}`);
  }

  const { url } = await res.json();
  if (!url) throw new Error('No checkout URL in response');
  window.location.href = url;
}

// 期末ダウングレードをスケジュールする（サーバで Subscription Schedule を作成）
// src/lib/billing.ts
export async function scheduleDowngrade(plan: 'light' | 'basic' | 'pro'): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch('/api/stripe/schedule-downgrade', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ plan }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server responded ${res.status}: ${text}`);
  }
}

