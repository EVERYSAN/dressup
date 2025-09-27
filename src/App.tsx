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
  const { showPromptPanel, setShowPromptPanel, showHistory, setShowHistory } = useAppStore();

  // Mobile 初回は左右パネルを閉じる
  React.useEffect(() => {
    const checkMobile = () => {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        setShowPromptPanel(false);
        setShowHistory(false);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [setShowPromptPanel, setShowHistory]);

  return (
    // ← min-h-screen ではなく h-screen。html/body/#root=100% とセットで使う
    <div className="h-screen bg-white text-gray-900 flex flex-col font-sans">
      <Header />

      {/* ← overflow-hidden をやめて min-h-0 に。子要素がスクロール可能に */}
      <div className="flex-1 flex min-h-0">
        {/* 左パネル：高さ100%で内部スクロール */}
        <div className={cn(
          "flex-shrink-0 transition-all duration-300 h-full overflow-y-auto",
          !showPromptPanel && "w-8"
        )}>
          <PromptComposer />
        </div>

        {/* キャンバス：中面は必要に応じて独自管理 */}
        <div className="flex-1 min-w-0">
          <ImageCanvas />
        </div>

        {/* 右パネル：高さ100%で内部スクロール（HistoryPanel 側の overflow 管理でもOK） */}
        <div className="flex-shrink-0 h-full overflow-y-auto">
          <HistoryPanel />
        </div>
      </div>

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
