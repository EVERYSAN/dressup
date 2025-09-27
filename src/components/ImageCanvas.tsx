import React, { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/Button';
import { ZoomIn, ZoomOut, RotateCcw, Download, Eye, EyeOff, Eraser } from 'lucide-react';
import { cn } from '../utils/cn';

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

  const stageRef = useRef<any>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<number[]>([]);

  // 安全: 画像の左上オフセット（ステージ座標）を計算
  const imageOffset = React.useMemo(() => {
    const iw = image?.width ?? 0;
    const ih = image?.height ?? 0;
    const { width: sw, height: sh } = stageSize;
    const zoom = canvasZoom || 1;
    const x = (sw / zoom - iw) / 2;
    const y = (sh / zoom - ih) / 2;
    return { x, y };
  }, [image, stageSize, canvasZoom]);

  // 画像ロード時のオートフィット
  useEffect(() => {
    if (canvasImage) {
      const img = new window.Image();
      img.onload = () => {
        setImage(img);
        if ((canvasZoom ?? 1) === 1 && (canvasPan?.x ?? 0) === 0 && (canvasPan?.y ?? 0) === 0) {
          const isMobile = window.innerWidth < 768;
          const padding = isMobile ? 0.9 : 0.8;
          const scaleX = (stageSize.width * padding) / img.width;
          const scaleY = (stageSize.height * padding) / img.height;
          const maxZoom = isMobile ? 0.3 : 0.8;
          const optimalZoom = Math.min(scaleX, scaleY, maxZoom);
          setCanvasZoom(Number.isFinite(optimalZoom) && optimalZoom > 0 ? optimalZoom : 1);
          setCanvasPan({ x: 0, y: 0 });
        }
      };
      img.src = canvasImage;
    } else {
      setImage(null);
    }
  }, [canvasImage, stageSize, setCanvasZoom, setCanvasPan, canvasZoom, canvasPan]);

  // ステージサイズ追従
  useEffect(() => {
    const updateSize = () => {
      const container = document.getElementById('canvas-container');
      if (container) {
        setStageSize({ width: container.offsetWidth, height: container.offsetHeight });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // ポインタ取得（null/undefined 安全）
  const getRelativePointerSafe = () => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getRelativePointerPosition?.();
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
    return pos;
  };

  const handleMouseDown = () => {
    if (selectedTool !== 'mask' || !image) return;
    const pos = getRelativePointerSafe();
    if (!pos) return;

    const relativeX = pos.x - imageOffset.x;
    const relativeY = pos.y - imageOffset.y;
    if (relativeX >= 0 && relativeX <= (image?.width ?? 0) && relativeY >= 0 && relativeY <= (image?.height ?? 0)) {
      setIsDrawing(true);
      setCurrentStroke([relativeX, relativeY]);
    }
  };

  const handleMouseMove = () => {
    if (!isDrawing || selectedTool !== 'mask' || !image) return;
    const pos = getRelativePointerSafe();
    if (!pos) return;

    const relativeX = pos.x - imageOffset.x;
    const relativeY = pos.y - imageOffset.y;
    if (relativeX >= 0 && relativeX <= (image?.width ?? 0) && relativeY >= 0 && relativeY <= (image?.height ?? 0)) {
      setCurrentStroke((prev) => [...prev, relativeX, relativeY]);
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStroke.length >= 4) {
      addBrushStroke({
        id: `stroke-${Date.now()}`,
        points: currentStroke.slice(),
        brushSize,
      });
    }
    setCurrentStroke([]);
  };

  const handleZoom = (delta: number) => {
    const newZoom = Math.max(0.1, Math.min(3, (canvasZoom || 1) + delta));
    setCanvasZoom(newZoom);
  };

  const handleReset = () => {
    if (!image) return;
    const isMobile = window.innerWidth < 768;
    const padding = isMobile ? 0.9 : 0.8;
    const scaleX = (stageSize.width * padding) / (image.width || 1);
    const scaleY = (stageSize.height * padding) / (image.height || 1);
    const maxZoom = isMobile ? 0.3 : 0.8;
    const optimalZoom = Math.min(scaleX, scaleY, maxZoom);
    setCanvasZoom(Number.isFinite(optimalZoom) && optimalZoom > 0 ? optimalZoom : 1);
    setCanvasPan({ x: 0, y: 0 });
  };

  const handleDownload = () => {
    if (!canvasImage) return;
    if (canvasImage.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = canvasImage;
      link.download = `nano-banana-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // キャンバス平行移動の安全値
  const panX = ((canvasPan?.x ?? 0) * (canvasZoom || 1));
  const panY = ((canvasPan?.y ?? 0) * (canvasZoom || 1));

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          {/* Left: Zoom */}
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={() => handleZoom(-0.1)}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {Math.round((canvasZoom || 1) * 100)}%
            </span>
            <Button variant="outline" size="sm" onClick={() => handleZoom(0.1)}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {/* Right: Mask tools & Download */}
          <div className="flex items-center space-x-2">
            {selectedTool === 'mask' && (
              <>
                <div className="flex items-center space-x-2 mr-2">
                  <span className="text-xs text-gray-400">Brush:</span>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="w-16 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <span className="text-xs text-gray-400 w-6">{brushSize}</span>
                </div>
                <Button variant="outline" size="sm" onClick={clearBrushStrokes} disabled={brushStrokes.length === 0}>
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

      {/* Canvas */}
      <div id="canvas-container" className="flex-1 relative overflow-hidden bg-white">
        {!image && !isGenerating && (
          <div className="absolute inset-0 grid place-items-center px-4">
            {/* 省略: ウェルカムカード（そのまま） */}
            {/* … */}
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
          scaleX={canvasZoom || 1}
          scaleY={canvasZoom || 1}
          x={panX}
          y={panY}
          draggable={selectedTool !== 'mask'}
          onDragEnd={(e) => {
            const z = canvasZoom || 1;
            setCanvasPan({ x: e.target.x() / z, y: e.target.y() / z });
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}  // ← 大文字小文字 修正
          onMouseUp={handleMouseUp}      // ← 大文字小文字 修正
          style={{ cursor: selectedTool === 'mask' ? 'crosshair' : 'default' }}
        >
          <Layer>
            {image && (
              <KonvaImage
                image={image}
                x={imageOffset.x}
                y={imageOffset.y}
              />
            )}

            {/* Brush Strokes */}
            {showMasks &&
              brushStrokes.map((stroke) => (
                <Line
                  key={stroke.id}
                  points={Array.isArray(stroke.points) ? stroke.points : []}
                  stroke="#A855F7"
                  strokeWidth={stroke.brushSize}
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
                strokeWidth={brushSize}
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
            {brushStrokes.length > 0 && (
              <span className="text-yellow-600">{brushStrokes.length} brush stroke{brushStrokes.length !== 1 ? 's' : ''}</span>
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
