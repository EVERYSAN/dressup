import { supabase } from './supabaseClient';

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
}

export async function buy(plan: 'basic'|'pro') {
  const token = await getAccessToken();
  const r = await fetch('/api/stripe/create-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan })
  });
  const { url } = await r.json();
  window.location.href = url;
}

export async function openPortal() {
  const token = await getAccessToken();
  const r = await fetch('/api/stripe/create-portal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const { url } = await r.json();
  window.location.href = url;
}

export async function generate(payload: any) {
  const token = await getAccessToken();
  const r = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (r.status === 402) {
    // 残数ゼロ：課金導線へ誘導
    // 例）モーダルで「プランを購入」→ buy('basic')
  }
  return await r.json();
}
