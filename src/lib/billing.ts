// src/lib/billing.ts
// Stripe Checkout / Customer Portal を叩くクライアント側ユーティリティ（フロント専用）

type Plan = 'light' | 'basic' | 'pro';

async function postJson<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}',
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Server responded ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from server: ${text}`);
  }
}

/** プラン購入 → Stripe Checkout にリダイレクト */
export async function buy(plan: Plan) {
  try {
    const data = await postJson<{ url: string }>('/api/stripe/create-checkout', { plan });
    if (!data?.url) throw new Error('Checkout URL missing');
    window.location.href = data.url;
  } catch (err: any) {
    alert(`購入ページに進めませんでした:\n${err?.message ?? err}`);
    console.error(err);
  }
}

/** 請求先/支払い方法の変更 → Stripe Customer Portal へ */
export async function openPortal() {
  try {
    const data = await postJson<{ url: string }>('/api/stripe/create-portal');
    if (!data?.url) throw new Error('Portal URL missing');
    window.location.href = data.url;
  } catch (err: any) {
    alert(`支払い設定ページに進めませんでした:\n${err?.message ?? err}`);
    console.error(err);
  }
}
