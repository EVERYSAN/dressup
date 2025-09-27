import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/Button';
import { History, Download, Image as ImageIcon } from 'lucide-react';
import { cn } from '../utils/cn';
import { ImagePreviewModal } from './ImagePreviewModal';

export const HistoryPanel: React.FC = () => {
  const {
    currentProject,
    canvasImage,
    selectedGenerationId,
    selectedEditId,
    selectGeneration,
    selectEdit,
    showHistory,
    setShowHistory,
    setCanvasImage,
    selectedTool, // 'edit' 固定
  } = useAppStore();

  const [previewModal, setPreviewModal] = React.useState<{
    open: boolean;
    imageUrl: string;
    title: string;
    description?: string;
  }>({
    open: false,
    imageUrl: '',
    title: '',
    description: '',
  });

  const generations = currentProject?.generations ?? [];
  const edits = currentProject?.edits ?? [];

  // 画像サイズの表示
  const [imageDimensions, setImageDimensions] = React.useState<{ width: number; height: number } | null>(null);
  React.useEffect(() => {
    if (!canvasImage) return setImageDimensions(null);
    const img = new Image();
    img.onload = () => setImageDimensions({ width: img.width, height: img.height });
    img.src = canvasImage;
  }, [canvasImage]);

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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <History className="h-5 w-5 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-800">History & Variants</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowHistory(!showHistory)}
          className="h-6 w-6"
          title="Hide History Panel"
        >
          ×
        </Button>
      </div>

      {/* Variants Grid */}
      <div className="mb-6 flex-shrink-0 max-h-64 overflow-y-auto pr-1">
        <h4 className="text-xs font-semibold text-gray-700 mb-3">Current Variants</h4>

        {generations.length === 0 && edits.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🖼️</div>
            <p className="text-sm text-gray-500">No generations yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* Edits（中心） */}
            {edits.map((edit, index) => {
              const firstOut = edit.outputAssets?.[0];
              const url = firstOut?.url;
              const selected = selectedEditId === edit.id;
              return (
                <div
                  key={edit.id}
                  className={cn(
                    'relative aspect-square rounded-lg border-2 cursor-pointer transition-all duration-200 overflow-hidden',
                    selected ? 'border-yellow-400' : 'border-gray-700 hover:border-gray-600'
                  )}
                  onClick={() => {
                    if (url) {
                      setCanvasImage(url);
                      selectEdit(edit.id);
                      selectGeneration(null);
                    }
                  }}
                >
                  {url ? (
                    <img src={url} alt="Edited variant" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400" />
                    </div>
                  )}

                  <div className="absolute top-2 left-2 bg-purple-900/80 text-xs px-2 py-1 rounded text-purple-200">
                    Edit #{index + 1}
                  </div>
                </div>
              );
            })}

            {/* 生成を完全に使わないなら、このブロックは表示されないまま（空配列） */}
            {generations.map((generation, index) => {
              const firstOut = generation.outputAssets?.[0];
              const url = firstOut?.url;
              const selected = selectedGenerationId === generation.id;
              return (
                <div
                  key={generation.id}
                  className={cn(
                    'relative aspect-square rounded-lg border-2 cursor-pointer transition-all duration-200 overflow-hidden',
                    selected ? 'border-yellow-400' : 'border-gray-200 hover:border-gray-300'
                  )}
                  onClick={() => {
                    selectGeneration(generation.id);
                    selectEdit(null);
                    if (url) setCanvasImage(url);
                  }}
                >
                  {url ? (
                    <img src={url} alt="Generated variant" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 bg-white/80 text-xs px-2 py-1 rounded text-gray-700">
                    #{index + 1}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Current Image Info */}
      {(canvasImage || imageDimensions) && (
        <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
          <h4 className="text-xs font-semibold text-gray-700 mb-2">Current Image</h4>
          <div className="space-y-1 text-xs text-gray-500">
            {imageDimensions && (
              <div className="flex justify-between">
                <span>Dimensions:</span>
                <span className="text-gray-900">
                  {imageDimensions.width} × {imageDimensions.height}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Mode:</span>
              <span className="text-gray-700 capitalize">{selectedTool ?? 'edit'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Details（Edit中心） */}
      <div className="mb-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm flex-1 overflow-y-auto min-h-0">
        <h4 className="text-xs font-semibold text-gray-700 mb-2">Generation Details</h4>
        {(() => {
          const selEdit = edits.find((e) => e.id === selectedEditId);
          if (selEdit) {
            return (
              <div className="space-y-3">
                <div className="space-y-2 text-xs text-gray-500">
                  <div>
                    <span className="text-gray-700">Edit Instruction:</span>
                    <p className="text-gray-800 mt-1">{selEdit.instruction}</p>
                  </div>
                  <div className="flex justify-between">
                    <span>Type:</span>
                    <span>Image Edit</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Created:</span>
                    <span>{new Date(selEdit.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>

                {selEdit.maskReferenceAsset?.url && (
                  <div>
                    <h5 className="text-xs font-medium text-gray-600 mb-2">Masked Reference</h5>
                    <button
                      onClick={() =>
                        setPreviewModal({
                          open: true,
                          imageUrl: selEdit.maskReferenceAsset!.url,
                          title: 'Masked Reference Image',
                          description: 'The masked image sent to the model',
                        })
                      }
                      className="relative aspect-square w-16 rounded border border-gray-300 hover:border-gray-400 transition-colors overflow-hidden group"
                    >
                      <img src={selEdit.maskReferenceAsset.url} alt="Masked reference" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <ImageIcon className="h-3 w-3 text-white opacity-0 group-hover:opacity-100" />
                      </div>
                      <div className="absolute bottom-1 left-1 bg-purple-900/80 text-xs px-1 py-0.5 rounded text-purple-200">
                        Mask
                      </div>
                    </button>
                  </div>
                )}
              </div>
            );
          }

          return <p className="text-xs text-gray-500">Select an edited image to view details</p>;
        })()}
      </div>

      {/* Actions */}
      <div className="space-y-3 flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-blue-600 hover:text-blue-800 border-blue-600 hover:border-blue-800"
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
            const urls: string[] = [
              ...edits.map((e) => e.outputAssets?.[0]?.url).filter(Boolean) as string[],
            ];

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

      <ImagePreviewModal
        open={previewModal.open}
        onOpenChange={(open) => setPreviewModal((prev) => ({ ...prev, open }))}
        imageUrl={previewModal.imageUrl}
        title={previewModal.title}
        description={previewModal.description}
      />
    </div>
  );
};
