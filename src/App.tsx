// src/App.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabaseClient';
import { Header } from './components/Header';
import { PromptComposer } from './components/PromptComposer';
import { ImageCanvas } from './components/ImageCanvas';
import { HistoryPanel } from './components/HistoryPanel';
import { cn } from './utils/cn';

const qc = new QueryClient();

export default function App() {
  const [ready, setReady] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  // --- ここが今日のポイント ---
  // 1) ハッシュに access_token/refresh_token が居たら「手動で」取り込む
  //    detectSessionInUrl が走らなかった場合の保険
  useEffect(() => {
    const hash = window.location.hash ?? '';
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.slice(1)); // remove '#'
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');

      // eslint-disable-next-line no-console
      console.log('[AUTH] OAuth redirect hash detected', {
        hasAccessToken: !!access_token,
        hasRefreshToken: !!refresh_token,
      });

      // Supabase が拾えていない場合にのみ setSession を試す
      (async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session && access_token && refresh_token) {
          try {
            const { data: setRes, error } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (error) throw error;
            // eslint-disable-next-line no-console
            console.log('[AUTH] setSession success:', {
              user: setRes.session?.user?.email,
            });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[AUTH] setSession failed:', e);
          }
        }

        // URL を綺麗にしておく（ハッシュ削除）
        history.replaceState(null, '', window.location.pathname);
      })();
    }
  }, []);

  // 2) 常に auth の変化を拾って UI/ストアを更新
  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange(async (event, session) => {
      // eslint-disable-next-line no-console
      console.log('[AUTH] onAuthStateChange:', event, {
        hasSession: !!session,
        user: session?.user?.email,
      });
      setSessionEmail(session?.user?.email ?? null);
      if (event === 'TOKEN_REFRESHED') {
        // 参考: ここで必要に応じてトースト等
      }
    });

    // 起動直後の状態も反映
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSessionEmail(data.session?.user?.email ?? null);
      // eslint-disable-next-line no-console
      console.log('[AUTH] initial session:', {
        hasSession: !!data.session,
        user: data.session?.user?.email,
      });
      setReady(true);
    })();

    return () => sub.data.subscription.unsubscribe();
  }, []);

  const appClass = useMemo(() => cn('min-h-screen bg-white'), []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-sm text-gray-500">Initializing…</div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={qc}>
      <div className={appClass}>
        <Header />
        {/* 必要なら現在のログイン状態をデバッグ表示（消してOK） */}
        {import.meta.env.DEV && (
          <div className="fixed bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
            auth: {sessionEmail ?? 'guest'}
          </div>
        )}
        <main className="mx-auto grid max-w-screen-2xl grid-cols-12 gap-3 p-3">
          <section className="col-span-3">
            <PromptComposer />
          </section>
          <section className="col-span-6">
            <ImageCanvas />
          </section>
          <aside className="col-span-3">
            <HistoryPanel />
          </aside>
        </main>
      </div>
    </QueryClientProvider>
  );
}
