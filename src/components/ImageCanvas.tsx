// src/components/ImageCanvas.tsx
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/Button';
import { ZoomIn, ZoomOut, RotateCcw, Download, Eye, EyeOff, Eraser } from 'lucide-react';
import { cn } from '../utils/cn';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const ImageCanvas: React.FC = () => {
  const {
    canvasImage,
    canvasZoom,
    setCanvasZoom,
    canvasPan,
    setCanvasPan,
    brushStrokes,
    addBrushStroke,
    clearBrushStrokes,
    showMasks,
    setShowMasks,
    selectedTool,
    isGenerating,
    brushSize,
    setBrushSize,
  } = useAppStore();

  // ---- store 値の安全デフォルト ----
  const z = Number.isFinite(canvasZoom) ? (canvasZoom as number) : 1;
  const pan = canvasPan ?? { x: 0, y: 0 };
  const strokes = Array.isArray(brushStrokes) ? brushStrokes : [];

  // ---- DOM refs ----
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ---- local state ----
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<number[]>([]);
  const lastFittedSrcRef = useRef<string | null>(null); // 画像が変わった時だけオートフィット

  // ピンチ用
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const pinchCenterRef = useRef<{ x: number; y: number } | null>(null);

  // ---- ステージサイズ追従（ResizeObserver で確実に）----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const applySize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      setStageSize({ width: w, height: h });
    };
    applySize();

    const ro = new ResizeObserver(() => applySize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- 画像の左上（ステージ座標）----
  const imageOffset = useMemo(() => {
    const iw = image?.width ?? 0;
    const ih = image?.height ?? 0;
    // 画像をステージ中央に配置（ズーム前提）
    const x = (stageSize.width / z - iw) / 2;
    const y = (stageSize.height / z - ih) / 2;
    return { x, y };
  }, [image, stageSize, z]);

  // ---- “その場”ズーム：point はステージ座標 ----
  const zoomAt = (point: { x: number; y: number }, nextZoom: number) => {
    const stage = stageRef.current;
    if (!stage) return;

    const newZ = clamp(nextZoom, 0.1, 3);

    // ズーム前のステージの平行移動量（パンはズームの倍率分だけ適用される）
    // point をスクリーン中央に保つようにパンを調整
    const mousePointTo = {
      x: (point.x - pan.x * z) / z,
      y: (point.y - pan.y * z) / z,
    };

    const newPan = {
      x: point.x / newZ - mousePointTo.x,
      y: point.y / newZ - mousePointTo.y,
    };

    setCanvasZoom(newZ);
    setCanvasPan(newPan);
  };

  // ---- オートフィット helper ----
  const fitToStage = (img: HTMLImageElement) => {
    const W = stageSize.width;
    const H = stageSize.height;
    if (W <= 0 || H <= 0) return;

    // 画像がステージに収まる最大倍率を算出
    // 初期表示では「拡大しない」ため 1 を上限にする（<= 100%）
    const padding = 0.92; // 余白
    const scaleX = (W * padding) / img.width;
    const scaleY = (H * padding) / img.height;
    const fit = Math.min(scaleX, scaleY);
    const notZoomIn = Math.min(1, fit); // ここがポイント（モバイルで巨大化しない）

    const clamped = clamp(notZoomIn, 0.1, 3);
    setCanvasZoom(clamped);
    setCanvasPan({ x: 0, y: 0 });
  };

  // ---- 画像ロード ----
  useEffect(() => {
    if (!canvasImage) {
      setImage(null);
      lastFittedSrcRef.current = null;
      return;
    }
    const img = new window.Image();
    img.onload = () => {
      setImage(img);

      // 新しい画像に切り替わった時だけオートフィット
      if (lastFittedSrcRef.current !== canvasImage) {
        fitToStage(img);
        lastFittedSrcRef.current = canvasImage;
      }
    };
    img.src = canvasImage;
  }, [canvasImage, stageSize.width, stageSize.height]);

  // ---- マウス座標 helper ----
  const getRelativePointerSafe = () => {
    const stage = stageRef.current;
    if (!stage?.getRelativePointerPosition) return null;
    const pos = stage.getRelativePointerPosition();
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
    return pos;
  };

  // ---- マスク描画 ----
  const handleMouseDown = () => {
    if (selectedTool !== 'mask' || !image) return;
    const pos = getRelativePointerSafe();
    if (!pos) return;

    const rx = pos.x - imageOffset.x;
    const ry = pos.y - imageOffset.y;
    if (rx >= 0 && rx <= image.width && ry >= 0 && ry <= image.height) {
      setIsDrawing(true);
      setCurrentStroke([rx, ry]);
    }
  };

  const handleMouseMove = () => {
    if (!isDrawing || selectedTool !== 'mask' || !image) return;
    const pos = getRelativePointerSafe();
    if (!pos) return;

    const rx = pos.x - imageOffset.x;
    const ry = pos.y - imageOffset.y;
    if (rx >= 0 && rx <= image.width && ry >= 0 && ry <= image.height) {
      setCurrentStroke((prev) => [...prev, rx, ry]);
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStroke.length >= 4) {
      addBrushStroke({
        id: `stroke-${Date.now()}`,
        points: currentStroke.slice(),
        brushSize: brushSize ?? 10,
      });
    }
    setCurrentStroke([]);
  };

  // ---- ズーム（ボタン） ----
  const handleZoomButton = (delta: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const center = { x: stageSize.width / 2, y: stageSize.height / 2 };
    zoomAt(center, z + delta);
  };

  const handleReset = () => {
    if (image) fitToStage(image);
  };

  // ---- ダウンロード ----
  const handleDownload = () => {
    if (!canvasImage) return;
    if (canvasImage.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = canvasImage;
      link.download = `dressup-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // ---- ステージ適用オフセット（ズーム込み）----
  const panX = pan.x * z;
  const panY = pan.y * z;

  // ---- ホイールズーム（PC / トラックパッド）----
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // deltaY 正で縮小、負で拡大（一般的な操作感）
    const direction = e.evt.deltaY > 0 ? -0.1 : 0.1;
    zoomAt(pointer, z + direction);
  };

  // ---- ピンチズーム（スマホ）----
  const handleTouchStart = (e: any) => {
    if (e.evt.touches?.length === 2) {
      const [t1, t2] = e.evt.touches;
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      pinchStartDistRef.current = dist;
      pinchStartZoomRef.current = z;

      const stage = stageRef.current;
      if (stage) {
        const rect = stage.container().getBoundingClientRect();
        const cx = (t1.clientX + t2.clientX) / 2 - rect.left;
        const cy = (t1.clientY + t2.clientY) / 2 - rect.top;
        pinchCenterRef.current = { x: cx, y: cy };
      }
    }
  };

  const handleTouchMove = (e: any) => {
    if (e.evt.touches?.length === 2 && pinchStartDistRef.current && pinchCenterRef.current) {
      e.evt.preventDefault();
      const [t1, t2] = e.evt.touches;
      const newDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const scale = newDist / pinchStartDistRef.current;
      const next = clamp(pinchStartZoomRef.current * scale, 0.1, 3);
      zoomAt(pinchCenterRef.current, next);
    }
  };

  const handleTouchEnd = () => {
    pinchStartDistRef.current = null;
    pinchCenterRef.current = null;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={() => handleZoomButton(-0.1)}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {Math.round(z * 100)}%
            </span>
            <Button variant="outline" size="sm" onClick={() => handleZoomButton(0.1)}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            {selectedTool === 'mask' && (
              <>
                <div className="flex items-center space-x-2 mr-2">
                  <span className="text-xs text-gray-400">Brush:</span>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    value={brushSize ?? 10}
                    onChange={(e) => setBrushSize(parseInt(e.target.value || '10', 10))}
                    className="w-16 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <span className="text-xs text-gray-400 w-6">{brushSize ?? 10}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearBrushStrokes}
                  disabled={strokes.length === 0}
                >
                  <Eraser className="h-4 w-4" />
                </Button>
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMasks(!showMasks)}
              className={cn(showMasks && 'bg-yellow-400/10 border-yellow-400/50')}
            >
              {showMasks ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              <span className="hidden sm:inline ml-2 text-gray-600">マスク</span>
            </Button>

            {canvasImage && (
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div ref={containerRef} id="canvas-container" className="flex-1 relative overflow-hidden bg-white">
        {!image && !isGenerating && (
          <div className="absolute inset-0 grid place-items-center px-4">
            <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
              <h2 className="text-2xl font-semibold text-gray-900 text-center tracking-tight">
                DRESSUP へようこそ
              </h2>
              <p className="mt-2 text-sm text-gray-600 text-center">
                3分で使い始められます。左の「編集」からどうぞ。
              </p>
              <ol className="mt-6 space-y-4 text-gray-800">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white text-xs font-semibold">1</span>
                  <div className="leading-relaxed">
                    <div className="font-medium">画像を2枚アップロード</div>
                    <ul className="mt-1 ml-6 list-disc text-sm text-gray-600">
                      <li>1枚目：変更元画像（モデルの人物写真）</li>
                      <li>2枚目：差し替えたい画像（服やアクセサリーの写真）</li>
                    </ul>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white text-xs font-semibold">2</span>
                  <div className="leading-relaxed">
                    <div className="font-medium">AIに指示</div>
                    <ul className="mt-1 ml-6 list-disc text-sm text-gray-600">
                      <li>「1枚目の服を2枚目の服に置き換えてください」</li>
                      <li>「1枚目の人物に2枚目のネックレスを追加してください」</li>
                    </ul>
                  </div>
                </li>
              </ol>
            </div>
          </div>
        )}

        {isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mb-4" />
              <p className="text-gray-700">Creating your image...</p>
            </div>
          </div>
        )}

        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          scaleX={z}
          scaleY={z}
          x={panX}
          y={panY}
          draggable={selectedTool !== 'mask'}
          onDragEnd={(e) => {
            setCanvasPan({ x: e.target.x() / z, y: e.target.y() / z });
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ cursor: selectedTool === 'mask' ? 'crosshair' : 'default' }}
        >
          <Layer>
            {image && (
              <KonvaImage image={image} x={imageOffset.x} y={imageOffset.y} />
            )}

            {/* Brush Strokes */}
            {showMasks &&
              strokes.map((stroke) => (
                <Line
                  key={stroke.id}
                  points={Array.isArray(stroke.points) ? stroke.points : []}
                  stroke="#A855F7"
                  strokeWidth={stroke.brushSize ?? 10}
                  tension={0.5}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation="source-over"
                  opacity={0.6}
                  x={imageOffset.x}
                  y={imageOffset.y}
                />
              ))}

            {/* 現在のストローク */}
            {isDrawing && currentStroke.length > 2 && (
              <Line
                points={currentStroke}
                stroke="#A855F7"
                strokeWidth={brushSize ?? 10}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation="source-over"
                opacity={0.6}
                x={imageOffset.x}
                y={imageOffset.y}
              />
            )}
          </Layer>
        </Stage>
      </div>

      {/* Status Bar */}
      <div className="p-3 border-t border-gray-200 bg-white">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <div className="flex items-center space-x-4">
            {strokes.length > 0 && (
              <span className="text-yellow-600">
                {strokes.length} brush stroke{strokes.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-gray-500">
              © 2025 EVERYSAN —
              <a
                href="https://note.com/everysan"
                target="_blank"
                rel="noopener noreferrer"
                className="text-yellow-600 hover:text-yellow-500 transition-colors ml-1"
              >
                Reinventing.AI Solutions
              </a>
            </span>
            <span className="text-gray-600 hidden md:inline">•</span>
            <span className="text-yellow-600 hidden md:inline">⚡</span>
            <span className="hidden md:inline">Powered by Gemini 2.5 Flash Image</span>
          </div>
        </div>
      </div>
    </div>
  );
};
