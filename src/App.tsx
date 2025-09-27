import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cn } from './utils/cn';
import { Header } from './components/Header';
import { PromptComposer } from './components/PromptComposer';
import { ImageCanvas } from './components/ImageCanvas';
import { HistoryPanel } from './components/HistoryPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAppStore } from './store/useAppStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 2 },
  },
});

function AppContent() {
  useKeyboardShortcuts();

  const {
    showPromptPanel,
    setShowPromptPanel,
    showHistory,
    setShowHistory,
  } = useAppStore();

  const [isMobile, setIsMobile] = React.useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  // 初回&リサイズでモバイル判定
  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // モバイル初回は左右パネルを閉じる
  React.useEffect(() => {
    if (isMobile) {
      setShowPromptPanel(false);
      setShowHistory(false);
    }
  }, [isMobile, setShowPromptPanel, setShowHistory]);

  // 背景クリックで閉じる（オーバーレイ時）
  const closeAllOverlays = () => {
    setShowPromptPanel(false);
    setShowHistory(false);
  };

  return (
    <div className="h-screen bg-white text-gray-900 flex flex-col font-sans">
      <Header />

      {/* モバイル専用ツールバー（編集／履歴トグル） */}
      {isMobile && (
        <div className="mobile-toolbar md:hidden">
          <button
            className={cn(
              "px-3 py-2 rounded-md text-sm font-medium",
              showPromptPanel ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700"
            )}
            onClick={() => {
              setShowPromptPanel((v) => !v);
              setShowHistory(false);
            }}
          >
            ✂ 編集
          </button>
          <button
            className={cn(
              "px-3 py-2 rounded-md text-sm font-medium",
              showHistory ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-800"
            )}
            onClick={() => {
              setShowHistory((v) => !v);
              setShowPromptPanel(false);
            }}
          >
            🕘 履歴
          </button>
        </div>
      )}

      {/* コンテンツ */}
      <div className="flex-1 flex min-h-0 relative">

        {/* 左パネル（編集） */}
        {/* PC: 常時サイドバー / モバイル: オーバーレイ */}
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
          <div className={cn(
            "flex-shrink-0 transition-all duration-300 h-full overflow-y-auto border-r border-gray-200",
            !showPromptPanel ? "w-10" : "w-[320px]"
          )}>
            <PromptComposer />
          </div>
        )}

        {/* キャンバス */}
        <div className="flex-1 min-w-0">
          <ImageCanvas />
        </div>

        {/* 右パネル（履歴） */}
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

      {/* フッター（そのまま） */}
      <footer className="border-t border-gray-200 bg-white text-xs text-gray-500 px-4 py-3">
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
