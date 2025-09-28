import { supabase } from './supabaseClient';

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
}

export async function buy(plan:'basic'|'pro') {
  const r = await fetch('/api/stripe/create-checkout', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${await token()}` },
    body: JSON.stringify({ plan })
  });
  const { url } = await r.json();
  location.href = url;
}

export async function openPortal() {
  const r = await fetch('/api/stripe/create-portal', {
    method:'POST',
    headers:{ Authorization:`Bearer ${await token()}` }
  });
  const { url } = await r.json();
  location.href = url;
}

export async function generate(payload:any) {
  const r = await fetch('/api/generate', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${await token()}` },
    body: JSON.stringify(payload)
  });
  if (r.status === 402) return { ok:false, reason:'no-credits' };
  return await r.json();
}
