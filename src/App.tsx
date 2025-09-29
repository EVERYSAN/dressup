// src/App.tsx  — 完全版（セッション復元付き）
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 2 } },
});

// --- 追加: OAuth リダイレクト(#access_token 等)からセッションを復元 ---
function useRestoreSupabaseSessionFromHash() {
  React.useEffect(() => {
    // 例: #access_token=xxx&refresh_token=yyy&expires_in=3600&token_type=bearer
    if (typeof window === 'undefined') return;
    if (!location.hash || location.hash.length < 2) return;

    const params = new URLSearchParams(location.hash.slice(1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');

    // どちらかが無ければ何もしない（他用途のハッシュかもしれない）
    if (!access_token || !refresh_token) return;

    (async () => {
      try {
        const { data, error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) {
          console.error('[auth] setSession error', error);
          return;
        }
        // 成功したら URL をクリーンアップ（ハッシュ除去）
        history.replaceState(null, '', location.pathname + location.search);
        // 念のため最新ユーザーを取得しておく
        await supabase.auth.getUser();
        console.log('[auth] session restored from URL hash', data?.session?.user?.id);
      } catch (e) {
        console.error('[auth] restore from hash failed', e);
      }
    })();
  }, []);
}

function AppContent() {
  useKeyboardShortcuts();
  useRestoreSupabaseSessionFromHash();

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
                "md:static md:h满 md:overflow-y-auto md:block",
                showPromptPanel ? "block" : "hidden",
                "mobile-overlay mobile-overlay--left md:mobile-overlay:unset md:w-auto md:bg-transparent"
              )}
            >
              <PromptComposer />
            </div>
          </>
        ) : (
          <div className={cn(
            "flex-shrink-0 transition-all duration-300 h-full overflow-y-auto border-r border-gray-200",
            !showPromptPanel ? "w-10" : "w-[320px]"
          )}>
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

      {/* PC のみフッター（モバイルはタブと重なるので非表示） */}
      <footer className={cn("border-t border-gray-200 bg-white text-xs text-gray-500 px-4 py-3", isMobile && "hidden")}>
        <div>© 2025 EVERYSAN — Modified from NanoBananaEditor (AGPLv3)</div>
        <div className="mt-1">
          <a className="underline" href="https://github.com/EVERYSAN/dressup" target="_blank" rel="noreferrer">Source</a>
          {' · '}
          <a className="underline" href="/LICENSE" target="_blank" rel="noreferrer">License</a>
          {' · '}No warranty.
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
