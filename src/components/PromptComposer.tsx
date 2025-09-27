import React, { useState, useRef } from 'react';
import { Textarea } from './ui/Textarea';
import { Button } from './ui/Button';
import { useAppStore } from '../store/useAppStore';
import { useImageGeneration, useImageEditing } from '../hooks/useImageGeneration';
import { Upload, Wand2, Edit3, HelpCircle, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { PromptHints } from './PromptHints';
import { cn } from '../utils/cn';
import { resizeFileToDataURL, base64SizeMB } from '../utils/resizeImage';

export const PromptComposer: React.FC = () => {
  const {
    currentPrompt,
    setCurrentPrompt,
    selectedTool,
    setSelectedTool,
    temperature,
    setTemperature,
    seed,
    setSeed,

    // Generate 用
    uploadedImages,
    addUploadedImage,
    removeUploadedImage,
    clearUploadedImages,

    // Edit 用
    editReferenceImages,
    addEditReferenceImage,
    removeEditReferenceImage,
    clearEditReferenceImages,

    // キャンバス表示
    setCanvasImage,

    showPromptPanel,
    setShowPromptPanel,
    clearBrushStrokes,

    // ★ 履歴用
    ensureProject,
    addGeneration,
    addEdit,
  } = useAppStore();

  // ★ BASE（1枚目）を固定するローカル state
  const [baseImage, setBaseImage] = useState<string | null>(null);

  const { mutateAsync: generate, isPending: isGenPending } = useImageGeneration();
  const { mutateAsync: edit, isPending: isEditPending } = useImageEditing();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showHintsModal, setShowHintsModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const assertFn = (name: string, fn: any) => {
    if (typeof fn !== 'function') {
      console.error(`[DRESSUP] ${name} is not a function`, fn);
      throw new TypeError(`${name} is not a function`);
    }
  };

  // 生成/編集の実行：結果は中央のみ更新、BASEは不変
  const handleGenerateOrEdit = async () => {
    const prompt = currentPrompt.trim();
    if (!prompt) return;

    // 送信前のサイズ見積もり（Vercel Edge の 4MB 近辺対策）
    const approxTotalMB = (() => {
      const parts: string[] = [];
      if (selectedTool === 'generate') {
        parts.push(...uploadedImages);
      } else {
        if (baseImage) parts.push(baseImage);
        if (editReferenceImages[0]) parts.push(editReferenceImages[0]);
      }
      return parts.reduce((sum, p) => sum + base64SizeMB(p), 0);
    })();
    if (approxTotalMB > 3.5) {
      console.warn(`[DRESSUP] payload too large (~${approxTotalMB.toFixed(2)} MB). Try smaller images.`);
      return;
    }

    try {
      if (selectedTool === 'generate') {
        assertFn('generate', generate);
        const resp: any = await generate({
          prompt,
          referenceImages: uploadedImages.length ? uploadedImages : undefined,
        });

        const parts = resp?.candidates?.[0]?.content?.parts;
        const img = parts?.find((p: any) => p?.inlineData?.data)?.inlineData;
        if (img?.data) {
          const mime = img?.mimeType || 'image/png';
          const dataUrl = `data:${mime};base64,${img.data}`;
          setCanvasImage(dataUrl);

          // ★ 履歴に積む
          ensureProject();
          addGeneration({
            id: `gen-${Date.now()}`,
            prompt,
            modelVersion: resp?.modelVersion || 'gemini-2.5-flash-image-preview',
            parameters: { seed },
            sourceAssets: (uploadedImages || []).map((u, i) => ({ id: `src-${i}`, url: u })),
            outputAssets: [{ id: 'out-0', url: dataUrl }],
            timestamp: Date.now(),
          });
        }
      } else {
        // ★ 常に BASE を image1 として送る（＝連鎖編集を断つ）
        if (!baseImage) return;
        assertFn('edit', edit);
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

          // ★ 履歴に積む
          ensureProject();
          addEdit({
            id: `edit-${Date.now()}`,
            instruction: prompt,
            parentGenerationId: null,
            maskReferenceAsset: null,
            outputAssets: [{ id: 'out-0', url: dataUrl }],
            timestamp: Date.now(),
          });
        }
      }
    } catch (e) {
      console.error('[DRESSUP] handleGenerateOrEdit failed', e);
    }
  };

  // アップロード
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const dataUrl = await resizeFileToDataURL(file, { maxEdge: 1024, mime: 'image/webp', quality: 0.85 });
        const mb = base64SizeMB(dataUrl);
        console.log(`[DRESSUP] resized upload ~${mb.toFixed(2)} MB`);

        if (selectedTool === 'generate') {
          if (!uploadedImages.includes(dataUrl) && uploadedImages.length < 2) {
            addUploadedImage(dataUrl);
          }
        } else {
          // Edit: 1枚目は BASE、2枚目以降は参照
          if (!baseImage) {
            setBaseImage(dataUrl);
            setCanvasImage(dataUrl); // キャンバスにも表示
          } else {
            if (!editReferenceImages.includes(dataUrl) && editReferenceImages.length < 2) {
              addEditReferenceImage(dataUrl);
            }
          }
        }
      } catch (error) {
        console.error('Failed to upload image:', error);
      }
    }
  };

  const handleClearSession = () => {
    setCurrentPrompt('');
    clearUploadedImages();
    clearEditReferenceImages();
    clearBrushStrokes();
    setBaseImage(null);
    setCanvasImage(null);
    setSeed(null);
    setTemperature(0.7);
    setShowClearConfirm(false);
  };

  // ツール定義（マスク機能は無し）
  const tools = [
    { id: 'generate', icon: Wand2, label: 'Generate', description: 'Create from text' },
    { id: 'edit', icon: Edit3, label: 'Edit', description: 'Modify existing' },
  ] as const;

  if (!showPromptPanel) {
    return (
      <div className="w-8 bg-gray-950 border-r border-gray-200 flex flex-col items-center justify-center">
        <button
          onClick={() => setShowPromptPanel(true)}
          className="w-6 h-16 bg-gray-800 hover:bg-gray-700 rounded-r-lg border border-l-0 border-gray-700 flex items-center justify-center transition-colors group"
          title="Show Prompt Panel"
        >
          <div className="flex flex-col space-y-1">
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full"></div>
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full"></div>
            <div className="w-1 h-1 bg-gray-500 group-hover:bg-gray-400 rounded-full"></div>
          </div>
        </button>
      </div>
    );
  }

  const hasPrompt = currentPrompt.trim().length > 0;
  const canGenerate = selectedTool === 'generate' && hasPrompt && !isGenPending;
  const canEdit = selectedTool === 'edit' && hasPrompt && !!baseImage && !isEditPending;

  return (
    <>
      <div className="w-80 lg:w-72 xl:w-80 h-full bg-gray-950 border-r border-gray-200 p-6 flex flex-col space-y-6 overflow-y-auto">
        {/* Mode */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-300">Mode</h3>
            <div className="flex items-center space-x-1">
              <Button variant="ghost" size="icon" onClick={() => setShowHintsModal(true)} className="h-6 w-6">
                <HelpCircle className="h-4 w-4" />
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
          <div className="grid grid-cols-2 gap-2">
            {tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => setSelectedTool(tool.id)}
                className={cn(
                  'flex flex-col items-center p-3 rounded-lg border transition-all duration-200',
                  selectedTool === tool.id
                    ? 'bg-yellow-400/10 border-yellow-400/50 text-yellow-400'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                )}
              >
                <tool.icon className="h-5 w-5 mb-1" />
                <span className="text-xs font-medium">{tool.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Uploads */}
        <div>
          <label className="text-sm font-medium text-gray-300 mb-1 block">
            {selectedTool === 'generate' ? 'Reference Images' : 'Style References'}
          </label>
          {selectedTool === 'generate' && <p className="text-xs text-gray-500 mb-3">Optional, up to 2 images</p>}
          {selectedTool === 'edit' && (
            <p className="text-xs text-gray-500 mb-3">
              {baseImage ? 'Optional style references, up to 2 images' : 'Upload the base image (1st), then optional references'}
            </p>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="w-full"
            disabled={
              (selectedTool === 'generate' && uploadedImages.length >= 2) ||
              (selectedTool === 'edit' && editReferenceImages.length >= 2)
            }
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>

          {/* ★ 左：BASE（固定） */}
          {selectedTool === 'edit' && baseImage && (
            <div className="mt-3 space-y-2">
              <div className="relative">
                <img
                  src={baseImage}
                  alt="Base"
                  className="w-full h-24 object-cover rounded-lg border border-gray-700"
                />
                <button
                  onClick={() => {
                    setBaseImage(null);
                    setCanvasImage(null);
                    clearEditReferenceImages();
                  }}
                  className="absolute top-1 right-1 bg-white/80 text-gray-700 hover:text-gray-900 rounded-full p-1 transition-colors"
                  title="Clear base image"
                >
                  ×
                </button>
                <div className="absolute bottom-1 left-1 bg-white/80 text-xs px-2 py-1 rounded text-gray-700 font-medium">
                  Base
                </div>
              </div>
            </div>
          )}

          {/* 参照画像 */}
          {((selectedTool === 'generate' && uploadedImages.length > 0) ||
            (selectedTool === 'edit' && editReferenceImages.length > 0)) && (
            <div className="mt-3 space-y-2">
              {(selectedTool === 'generate' ? uploadedImages : editReferenceImages).map((image, index) => (
                <div key={index} className="relative">
                  <img src={image} alt={`Reference ${index + 1}`} className="w-full h-20 object-cover rounded-lg border border-gray-700" />
                  <button
                    onClick={() => (selectedTool === 'generate' ? removeUploadedImage(index) : removeEditReferenceImage(index))}
                    className="absolute top-1 right-1 bg-white/80 text-gray-700 hover:text-gray-900 rounded-full p-1 transition-colors"
                    title="Remove"
                  >
                    ×
                  </button>
                  <div className="absolute bottom-1 left-1 bg-white/80 text-xs px-2 py-1 rounded text-gray-700">Ref {index + 1}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div>
          <label className="text-sm font-medium text-gray-300 mb-3 block">
            {selectedTool === 'generate' ? 'Describe what you want to create' : 'Describe your changes'}
          </label>
          <Textarea
            value={currentPrompt}
            onChange={(e) => setCurrentPrompt(e.target.value)}
            placeholder={
              selectedTool === 'generate'
                ? 'A product hero image on white background...'
                : 'Replace the 1st outfit with the 2nd reference; keep pose and lighting...'
            }
            className="min-h-[120px] resize-none"
          />

          <button onClick={() => setShowHintsModal(true)} className="mt-2 flex items-center text-xs hover:text-gray-400 transition-colors group">
            {currentPrompt.length < 20 ? (
              <HelpCircle className="h-3 w-3 mr-2 text-red-500 group-hover:text-red-400" />
            ) : (
              <div className={cn('h-2 w-2 rounded-full mr-2', currentPrompt.length < 50 ? 'bg-yellow-500' : 'bg-green-500')} />
            )}
            <span className="text-gray-500 group-hover:text-gray-400">
              {currentPrompt.length < 20 ? 'Add detail for better results' : currentPrompt.length < 50 ? 'Good detail level' : 'Excellent prompt detail'}
            </span>
          </button>
        </div>

        {/* Execute */}
        <Button
          onClick={handleGenerateOrEdit}
          disabled={selectedTool === 'generate' ? !canGenerate : !canEdit}
          className="w-full h-14 text-base font-medium"
        >
          {selectedTool === 'generate' ? (
            isGenPending ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900 mr-2" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                Generate
              </>
            )
          ) : isEditPending ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900 mr-2" />
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
            className="flex items-center text-sm text-gray-400 hover:text-gray-300 transition-colors duration-200"
          >
            {showAdvanced ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
            {showAdvanced ? 'Hide' : 'Show'} Advanced Controls
          </button>

          <button
            onClick={() => setShowClearConfirm(!showClearConfirm)}
            className="flex items-center text-sm text-gray-400 hover:text-red-400 transition-colors duration-200 mt-2"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Clear Session
          </button>

          {showClearConfirm && (
            <div className="mt-3 p-3 bg-gray-800 rounded-lg border border-gray-700">
              <p className="text-xs text-gray-300 mb-3">
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
                <label className="text-xs text-gray-400 mb-2 block">Creativity ({temperature})</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer slider"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-2 block">Seed (optional)</label>
                <input
                  type="number"
                  value={seed || ''}
                  onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="Random"
                  className="w-full h-8 px-2 bg-white border border-gray-700 rounded text-xs text-gray-900"
                />
              </div>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-gray-200">
          <h4 className="text-xs font-medium text-gray-400 mb-2">Shortcuts</h4>
          <div className="space-y-1 text-xs text-gray-500">
            <div className="flex justify-between"><span>Generate</span><span>⌘ + Enter</span></div>
            <div className="flex justify-between"><span>Re-roll</span><span>⇧ + R</span></div>
            <div className="flex justify-between"><span>History</span><span>H</span></div>
            <div className="flex justify-between"><span>Toggle Panel</span><span>P</span></div>
          </div>
        </div>
      </div>

      <PromptHints open={showHintsModal} onOpenChange={setShowHintsModal} />
    </>
  );
};
