// src/lib/auth-callback.ts
import { supabase } from './supabaseClient';

/**
 * Google OAuth のリダイレクト戻りを拾って、セッションを確定させる。
 * - PKCE:   ?code=... で戻る → exchangeCodeForSession()
 * - Implicit: #access_token=... → setSession()
 * 両方に対応。処理後はURLから余計なクエリ/ハッシュを削除する。
 */
export async function handleOAuthCallback(): Promise<void> {
  const url = new URL(window.location.href);

  // --- PKCE（codeフロー） ---
  if (url.searchParams.get('code')) {
    const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
    // 失敗しても次に進む（後段の onAuthStateChange で拾える場合がある）
    // URLのクリーンアップ
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    window.history.replaceState({}, '', url.toString());
    return;
  }

  // --- Implicit（ハッシュにトークンが載るフロー） ---
  if (window.location.hash.includes('access_token')) {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get('access_token') || undefined;
    const refresh_token = hash.get('refresh_token') || undefined;

    if (access_token && refresh_token) {
      // セッション確定
      await supabase.auth.setSession({ access_token, refresh_token });
    }
    // URLのクリーンアップ（ハッシュ削除）
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
  }
}
