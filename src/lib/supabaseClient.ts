// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const url =
  import.meta.env.VITE_SUPABASE_URL ??
  // フォールバック（誤設定検出ログ用）
  (import.meta.env.SUPABASE_URL as string);
const anon =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  (import.meta.env.SUPABASE_ANON_KEY as string);

if (!url || !anon) {
  // ここで絶対に気づけるように強ログ
  // eslint-disable-next-line no-console
  console.error('[SUPABASE] Missing env. VITE_SUPABASE_URL/ANON_KEY (or SUPABASE_URL/ANON_KEY)');
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // これが重要（#access_token, #refresh_token を自動で拾って保存してくれる）
      detectSessionInUrl: true,
      // Google から hash で返すフローを使う
      flowType: 'implicit',
    },
  }
);

// 起動時に1回、現在のセッションを強ログ
(async () => {
  try {
    const { data } = await supabase.auth.getSession();
    // eslint-disable-next-line no-console
    console.log('[SUPABASE] getSession at boot:', {
      hasSession: !!data.session,
      user: data.session?.user?.email,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[SUPABASE] getSession failed at boot:', e);
  }
})();
