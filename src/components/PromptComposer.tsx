// src/components/PromptComposer.tsx
import React, { useState, useRef } from 'react';
import { Textarea } from './ui/Textarea';
import { Button } from './ui/Button';
import { useAppStore } from '../store/useAppStore';
import { useImageEditing } from '../hooks/useImageGeneration';
import { Upload, Edit3, HelpCircle, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { PromptHints } from './PromptHints';
import { cn } from '../utils/cn';
import { resizeFileToDataURL, base64SizeMB } from '../utils/resizeImage';

export const PromptComposer: React.FC = () => {
  const {
    currentPrompt,
    setCurrentPrompt,
    temperature,
    setTemperature,
    seed,
    setSeed,

    editReferenceImages,
    addEditReferenceImage,
    removeEditReferenceImage,
    clearEditReferenceImages,

    setCanvasImage,

    showPromptPanel,
    setShowPromptPanel,
    clearBrushStrokes,

    ensureProject,
    addEdit,
  } = useAppStore();

  // Base はローカルで管理（不変に保つ）
  const [baseImage, setBaseImage] = useState<string | null>(null);

  const { mutateAsync: edit, isPending: isEditPending } = useImageEditing();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showHintsModal, setShowHintsModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleApplyEdit = async () => {
    const prompt = currentPrompt.trim();
    if (!prompt || !baseImage) return;

    // Vercel Edge 対策：payload を控えめに
    const approxTotalMB = [baseImage, editReferenceImages[0]]
      .filter(Boolean)
      .reduce((s, d) => s + base64SizeMB(d as string), 0);

    if (approxTotalMB > 3.5) {
      console.warn(`[DRESSUP] payload too large (~${approxTotalMB.toFixed(2)} MB). Try smaller images.`);
      return;
    }

    try {
      const resp: any = await edit({
        prompt,
        image1: baseImage,
        image2: editReferenceImages[0] || null,
      });

      const parts = resp?.candidates?.[0]?.content?.parts;
      const img = parts?.find((p: any) => p?.inlineData?.data)?.inlineData;
      if (img?.data) {
        const mime = img?.mimeType || 'image/png';
        const dataUrl = `data:${mime};base64,${img.data}`;
        setCanvasImage(dataUrl);

        // 履歴に追加
        ensureProject();
        addEdit({
          id: `edit-${Date.now()}`,
          instruction: prompt,
          parentGenerationId: null,
          maskReferenceAsset: null,
          outputAssets: [{ id: 'out-0', url: dataUrl }],
          timestamp: Date.now(),
        });
      } else {
        console.warn('[DRESSUP] [edit] no image in response');
      }
    } catch (e) {
      console.error('[DRESSUP] edit failed', e);
    }
  };

  // アップロード：先に Base、以降は Ref
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const dataUrl = await resizeFileToDataURL(file, { maxEdge: 1024, mime: 'image/webp', quality: 0.85 });
        const mb = base64SizeMB(dataUrl);
        console.log(`[DRESSUP] resized upload ~${mb.toFixed(2)} MB`);

        if (!baseImage) {
          setBaseImage(dataUrl);
          setCanvasImage(dataUrl);
        } else {
          if (!editReferenceImages.includes(dataUrl) && editReferenceImages.length < 2) {
            addEditReferenceImage(dataUrl);
          }
        }
      } catch (error) {
        console.error('Failed to upload image:', error);
      }
    }
  };

  const handleClearSession = () => {
    setCurrentPrompt('');
    clearEditReferenceImages();
    clearBrushStrokes();
    setBaseImage(null);
    setCanvasImage(null);
    setSeed(null);
    setTemperature(0.7);
    setShowClearConfirm(false);
  };

  if (!showPromptPanel) {
    return (
      <div className="w-8 bg-gray-950 border-r border-gray-200 flex flex-col items-center justify-center">
        <button
          onClick={() => setShowPromptPanel(true)}
          className="w-6 h-16 bg-gray-800 hover:bg-gray-700 rounded-r-lg border border-l-0 border-gray-700 flex items-center justify-center transition-colors group"
          title="Show Prompt Panel"
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

  const hasPrompt = currentPrompt.trim().length > 0;
  const canEdit = hasPrompt && !!baseImage && !isEditPending;

  return (
    <>
      <div className="w-80 lg:w-72 xl:w-80 h-full bg-emerald-50 border-r border-emerald-100 p-6 flex flex-col space-y-6 overflow-y-auto shadow-sm">
        {/* Header（Edit固定） */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-gray-800">Edit</h3>
          </div>
          <div className="flex items-center space-x-1">
            <Button variant="ghost" size="icon" onClick={() => setShowHintsModal(true)} className="h-6 w-6">
              <HelpCircle className="h-4 w-4 text-emerald-600" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPromptPanel(false)}
              className="h-6 w-6"
              title="Hide Prompt Panel"
            >
              ×
            </Button>
          </div>
        </div>

        {/* Uploads */}
        <div>
          <label className="text-sm font-medium text-gray-800 mb-2 block">Style References</label>

          {/* 2) Upload を白カード化 */}
          <div className="rounded-lg bg-white border border-emerald-200 p-2 shadow-sm">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full">
              <Upload className="h-4 w-4 mr-2" />
              Upload
            </Button>
          </div>

          {/* Base（正方形・白カード＆淡ボーダー） */}
          {baseImage && (
            <div className="mt-3 space-y-2">
              <div className="relative">
                <img
                  src={baseImage}
                  alt="Base"
                  className="aspect-square w-full max-h-[260px] object-cover rounded-lg border border-emerald-200 shadow-sm bg-white"
                />
                <button
                  onClick={() => {
                    setBaseImage(null);
                    setCanvasImage(null);
                    clearEditReferenceImages();
                  }}
                  className="absolute top-1 right-1 bg-gray-900/70 text-white hover:bg-gray-900 rounded-full p-1 transition-colors"
                  title="Clear base image"
                >
                  ×
                </button>
                <div className="absolute bottom-1 left-1 bg-emerald-600/90 text-white text-xs px-2 py-1 rounded font-medium">
                  Base
                </div>
              </div>
            </div>
          )}

          {/* Refs（白カード＆淡ボーダー） */}
          {editReferenceImages.length > 0 && (
            <div className="mt-3 space-y-2">
              {editReferenceImages.map((image, index) => (
                <div key={index} className="relative">
                  <img
                    src={image}
                    alt={`Reference ${index + 1}`}
                    className="aspect-square w-full max-h-[220px] object-cover rounded-lg border border-emerald-200 shadow-sm bg-white"
                  />
                  <button
                    onClick={() => removeEditReferenceImage(index)}
                    className="absolute top-1 right-1 bg-gray-900/70 text-white hover:bg-gray-900 rounded-full p-1 transition-colors"
                    title="Remove"
                  >
                    ×
                  </button>
                  <div className="absolute bottom-1 left-1 bg-emerald-600/90 text-white text-xs px-2 py-1 rounded">
                    Ref {index + 1}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div>
          <label className="text-sm font-medium text-gray-800 mb-3 block">Describe your changes</label>
          <Textarea
            value={currentPrompt}
            onChange={(e) => setCurrentPrompt(e.target.value)}
            placeholder="Replace the 1st outfit with the 2nd reference; keep pose and lighting..."
            className="min-h-[120px] resize-none bg-white border border-emerald-200 text-gray-900 placeholder:text-gray-400 focus:border-emerald-300 focus:ring-0"
          />

          <button
            onClick={() => setShowHintsModal(true)}
            className="mt-2 flex items-center text-xs transition-colors group"
          >
            {currentPrompt.length < 20 ? (
              <HelpCircle className="h-3 w-3 mr-2 text-red-500 group-hover:text-red-400" />
            ) : (
              <div className={cn('h-2 w-2 rounded-full mr-2', currentPrompt.length < 50 ? 'bg-yellow-500' : 'bg-green-500')} />
            )}
            <span className="text-gray-600 group-hover:text-gray-700">
              {currentPrompt.length < 20 ? 'Add detail for better results' : currentPrompt.length < 50 ? 'Good detail level' : 'Excellent prompt detail'}
            </span>
          </button>
        </div>

        {/* Execute */}
        <Button
          onClick={handleApplyEdit}
          disabled={!canEdit}
          className="w-full h-14 text-base font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-emerald-300 disabled:cursor-not-allowed"
        >
          {isEditPending ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white/80 mr-2" />
              Applying...
            </>
          ) : (
            <>
              <Edit3 className="h-4 w-4 mr-2" />
              Apply Edit
            </>
          )}
        </Button>

        {/* Advanced / Clear */}
        <div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center text-sm text-gray-700 hover:text-gray-900 transition-colors duration-200"
          >
            {showAdvanced ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
            {showAdvanced ? 'Hide' : 'Show'} Advanced Controls
          </button>

          <button
            onClick={() => setShowClearConfirm(!showClearConfirm)}
            className="flex items-center text-sm text-gray-700 hover:text-red-500 transition-colors duration-200 mt-2"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Clear Session
          </button>

          {showClearConfirm && (
            <div className="mt-3 p-3 bg-white rounded-lg border border-emerald-200">
              <p className="text-xs text-gray-700 mb-3">
                Are you sure you want to clear this session? This will remove all uploads, prompts, and canvas content.
              </p>
              <div className="flex space-x-2">
                <Button variant="destructive" size="sm" onClick={handleClearSession} className="flex-1">
                  Yes, Clear
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(false)} className="flex-1">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {showAdvanced && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-gray-700 mb-2 block">Creativity ({temperature})</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-2 bg-emerald-100 rounded-lg appearance-none cursor-pointer slider"
                />
              </div>
              <div>
                <label className="text-xs text-gray-700 mb-2 block">Seed (optional)</label>
                <input
                  type="number"
                  value={seed || ''}
                  onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="Random"
                  className="w-full h-8 px-2 bg-white border border-emerald-200 rounded text-xs text-gray-900 placeholder:text-gray-400 focus:border-emerald-300 focus:ring-0"
                />
              </div>
            </div>
          )}
        </div>

        {/* Shortcuts */}
        <div className="pt-4 border-t border-emerald-100">
          <h4 className="text-xs font-medium text-gray-700 mb-2">Shortcuts</h4>
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex justify-between"><span>History</span><span>H</span></div>
            <div className="flex justify-between"><span>Toggle Panel</span><span>P</span></div>
          </div>
        </div>
      </div>

      <PromptHints open={showHintsModal} onOpenChange={setShowHintsModal} />
    </>
  );
};
