import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/Button';
import { History, Download } from 'lucide-react';
import { cn } from '../utils/cn';

export const HistoryPanel: React.FC = () => {
  const {
    currentProject,
    canvasImage,
    selectedEditId,
    selectGeneration,
    selectEdit,
    showHistory,
    setShowHistory,
    setCanvasImage,
  } = useAppStore();

  const edits = currentProject?.edits ?? [];

  if (!showHistory) {
    return (
      <div className="w-8 bg-gray-950 border-l border-gray-200 flex flex-col items-center justify-center">
        <button
          onClick={() => setShowHistory(true)}
          className="w-6 h-16 bg-gray-800 hover:bg-gray-700 rounded-l-lg border border-r-0 border-gray-700 flex items-center justify-center transition-colors group"
          title="Show History Panel"
        >
          <div className="flex flex-col space-y-1">
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full" />
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full" />
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full" />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-l border-gray-200 p-6 flex flex-col h-full shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <History className="h-5 w-5 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-800">History</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowHistory(false)}
          className="h-6 w-6"
          title="Hide History Panel"
        >
          ×
        </Button>
      </div>

      {/* === 画像のみの履歴 ===
          - パネル全体の高さを使ってスクロール
          - 3列グリッド（幅に応じて2列へ崩してもOK） */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {edits.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-4xl mb-2">🖼️</div>
            <p className="text-sm text-gray-500">No images yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {edits.map((edit, index) => {
              const url = edit.outputAssets?.[0]?.url;
              const selected = selectedEditId === edit.id;
              return (
                <div
                  key={edit.id}
                  className={cn(
                    'relative aspect-square rounded-lg border-2 cursor-pointer transition-all duration-200 overflow-hidden',
                    selected
                      ? 'border-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.2)]'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                  onClick={() => {
                    if (url) {
                      setCanvasImage(url);
                      selectEdit(edit.id);
                      selectGeneration(null);
                    }
                  }}
                  title={`Edit #${index + 1}`}
                >
                  {url ? (
                    <img src={url} alt={`Edit ${index + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500" />
                    </div>
                  )}

                  {/* ラベル（左上） */}
                  <div className="absolute top-2 left-2 bg-emerald-600/90 text-white text-xs px-2 py-0.5 rounded">
                    Edit #{index + 1}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-3 pt-4 border-t border-gray-200">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-emerald-700 hover:text-emerald-800 border-emerald-600 hover:border-emerald-700"
          onClick={async () => {
            let imageUrl: string | null = null;
            const ed = edits.find((e) => e.id === selectedEditId);
            imageUrl = ed?.outputAssets?.[0]?.url ?? canvasImage ?? null;
            if (!imageUrl) return;

            try {
              if (imageUrl.startsWith('data:')) {
                const a = document.createElement('a');
                a.href = imageUrl;
                a.download = `dressup-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              } else {
                const blob = await fetch(imageUrl).then((r) => r.blob());
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dressup-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }
            } catch (e) {
              console.error('single download error', e);
            }
          }}
          disabled={!selectedEditId && !canvasImage}
        >
          <Download className="h-4 w-4 mr-2" />
          Download
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={async () => {
            if (!currentProject) return;
            const urls: string[] =
              edits.map((e) => e.outputAssets?.[0]?.url).filter(Boolean) as string[];

            for (let i = 0; i < urls.length; i++) {
              const url = urls[i];
              try {
                if (url.startsWith('data:')) {
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `dressup-${i + 1}.png`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                } else {
                  const blob = await fetch(url).then((r) => r.blob());
                  const o = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = o;
                  a.download = `dressup-${i + 1}.png`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(o);
                }
              } catch (e) {
                console.error('batch download error', e);
              }
            }
          }}
          disabled={edits.length === 0}
        >
          Download All
        </Button>
      </div>
    </div>
  );
};
