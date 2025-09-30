// src/App.tsx
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cn } from './utils/cn';
import { Header } from './components/Header';
import { PromptComposer } from './components/PromptComposer';
import { ImageCanvas } from './components/ImageCanvas';
import { HistoryPanel } from './components/HistoryPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAppStore } from './store/useAppStore';
import { supabase } from './lib/supabaseClient';

// -------------------------------
// QueryClient
// -------------------------------
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 2 } },
});

// -------------------------------
// 認証の“保険” + 初期化待ち
//   - #access_token / #refresh_token がURLハッシュにいたら手動で setSession
//   - onAuthStateChange で状態を同期
// -------------------------------
// src/App.tsx（要点のみ差分）
// …import は現状のままでOK

// --------------- Supabase bootstrap ---------------
function useSupabaseBootstrap() {
  const [ready, setReady] = React.useState(false);

  // セーフティ: 2秒経っても何かあればUIを出す（ハング防止）
  React.useEffect(() => {
    const t = setTimeout(() => setReady(true), 2000);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const hash = window.location.hash || '';
        if (hash.includes('access_token=')) {
          const params = new URLSearchParams(hash.slice(1));
          const access_token = params.get('access_token') ?? undefined;
          const refresh_token = params.get('refresh_token') ?? undefined;

          // 既に session が無ければ setSession
          const { data } = await supabase.auth.getSession();
          if (!data?.session && access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
            console.info('[AUTH] session restored from URL hash');
          }

          // ハッシュは見た目のために除去（& 二度実行防止）
          history.replaceState(null, '', window.location.pathname);
        }
      } catch (e) {
        console.error('[AUTH] bootstrap error:', e);
      } finally {
        // ここでは ready は上げない（下の init で上げる）
      }
    })();
  }, []);

  // 初期 getSession + 状態監視
  React.useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((ev, s) => {
      console.debug('[AUTH] state:', ev, !!s?.user);
    });

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.error('[AUTH] getSession init error:', error);
        console.debug('[AUTH] initial user?', !!data?.session?.user);
      } catch (e) {
        console.error('[AUTH] getSession fatal:', e);
      } finally {
        setReady(true); // ← 最後にUIを表示
      }
    })();

    return () => sub.data.subscription.unsubscribe();
  }, []);

  return ready;
}



// -------------------------------
// アプリ本体（元のフル幅レイアウトを維持）
// -------------------------------
function AppContent() {
  useKeyboardShortcuts();

  const {
    showPromptPanel, setShowPromptPanel,
    showHistory, setShowHistory,
  } = useAppStore();

  const [isMobile, setIsMobile] = React.useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  React.useEffect(() => {
    if (isMobile) { setShowPromptPanel(false); setShowHistory(false); }
  }, [isMobile, setShowPromptPanel, setShowHistory]);

  const closeAllOverlays = () => { setShowPromptPanel(false); setShowHistory(false); };

  return (
    <div className="app-viewport bg-white text-gray-900 flex flex-col font-sans">
      <Header />

      {/* コンテンツ（モバイルはタブ分の下余白を追加） */}
      <div className={cn("flex-1 flex min-h-0 relative", isMobile && "with-tabbar-pad")}>
        {/* 左（編集） */}
        {isMobile ? (
          <>
            {showPromptPanel && <div className="mobile-backdrop md:hidden" onClick={closeAllOverlays} />}
            <div
              className={cn(
                "md:static md:h-full md:overflow-y-auto md:block",
                showPromptPanel ? "block" : "hidden",
                "mobile-overlay mobile-overlay--left md:mobile-overlay:unset md:w-auto md:bg-transparent"
              )}
            >
              <PromptComposer />
            </div>
          </>
        ) : (
          <div
            className={cn(
              "flex-shrink-0 transition-all duration-300 h-full overflow-y-auto border-r border-gray-200",
              !showPromptPanel ? "w-10" : "w-[320px]"
            )}
          >
            <PromptComposer />
          </div>
        )}

        {/* 中央（生成結果 = キャンバス） */}
        <div className="flex-1 min-w-0">
          <ImageCanvas />
        </div>

        {/* 右（履歴） */}
        {isMobile ? (
          <>
            {showHistory && <div className="mobile-backdrop md:hidden" onClick={closeAllOverlays} />}
            <div
              className={cn(
                "md:static md:h-full md:overflow-y-auto md:block",
                showHistory ? "block" : "hidden",
                "mobile-overlay mobile-overlay--right md:mobile-overlay:unset md:w-auto md:bg-transparent"
              )}
            >
              <HistoryPanel />
            </div>
          </>
        ) : (
          <div className="flex-shrink-0 h-full overflow-y-auto border-l border-gray-200 w-[320px]">
            <HistoryPanel />
          </div>
        )}
      </div>

      {/* PC のみフッター（モバイルはタブと重なるので非表示） */}
      {isMobile ? null : (
        <footer className="border-t border-gray-200 bg-white text-xs text-gray-500 px-4 py-3">
          <div>© 2025 EVERYSAN — Modified from NanoBananaEditor (AGPLv3)</div>
          <div className="mt-1">
            <a className="underline" href="https://github.com/EVERYSAN/dressup" target="_blank" rel="noreferrer">Source</a>
            {' · '}
            <a className="underline" href="/LICENSE" target="_blank" rel="noreferrer">License</a>
            {' · '}No warranty.
          </div>
        </footer>
      )}

      {/* モバイル：下部タブ（生成結果 / 編集 / 履歴） */}
      {isMobile && (
        <nav className="mobile-tabbar md:hidden">
          <button
            className={cn("mobile-tabbar__btn", !showPromptPanel && !showHistory && "mobile-tabbar__btn--active")}
            onClick={() => { setShowPromptPanel(false); setShowHistory(false); }}
            aria-label="生成結果"
          >
            🖼️ <span>生成結果</span>
          </button>
          <button
            className={cn("mobile-tabbar__btn", showPromptPanel && "mobile-tabbar__btn--active")}
            onClick={() => { setShowPromptPanel(v => !v); setShowHistory(false); }}
            aria-label="編集"
          >
            ✂ <span>編集</span>
          </button>
          <button
            className={cn("mobile-tabbar__btn", showHistory && "mobile-tabbar__btn--active")}
            onClick={() => { setShowHistory(v => !v); setShowPromptPanel(false); }}
            aria-label="履歴"
          >
            🕘 <span>履歴</span>
          </button>
        </nav>
      )}
    </div>
  );
}

// -------------------------------
// ルート
// -------------------------------
function App() {
  const ready = useSupabaseBootstrap();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-sm text-gray-500">Initializing…</div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
