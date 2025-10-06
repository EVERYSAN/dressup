// src/components/ImageCanvas.tsx
import { Download, Eraser } from 'lucide-react';
import { Stage, Layer, Image as KonvaImage, Line, Text, Rect, Group } from 'react-konva';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/Button';
import { RotateCcw, Download, Eye, EyeOff, Eraser } from 'lucide-react';
import { cn } from '../utils/cn';

// 0.1〜3.0 のような「ズーム管理」はもう使わない。
// すべて「コンテナに収まるスケール = fitScale」で描画する。
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const ImageCanvas: React.FC = () => {
  const {
    canvasImage,
    brushStrokes,
    addBrushStroke,
    clearBrushStrokes,
    selectedTool,
    isGenerating,
    brushSize,
    setBrushSize,
    subscriptionTier = 'free',
  } = useAppStore();


  // === Refs
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // === Local state
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<number[]>([]);

  // === コンテナサイズ追従
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

  // === 画像ロード
  useEffect(() => {
    if (!canvasImage) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = canvasImage;
  }, [canvasImage]);

  // === fitScale: 画像がコンテナに収まる倍率（拡大しない＝最大1）
  const fitScale = useMemo(() => {
    if (!image) return 1;
    const padding = 0.92; // 余白（UIぶつかり回避）
    const sx = (stageSize.width * padding) / image.width;
    const sy = (stageSize.height * padding) / image.height;
    const fit = Math.min(sx, sy);
    // 小さい画像はぼかさないため等倍を上限にする
    return clamp(fit, 0.1, 1);
  }, [image, stageSize]);

  // === ステージにおける画像の左上（fitScaleで中央配置）
  const imageOffset = useMemo(() => {
    const iw = image?.width ?? 0;
    const ih = image?.height ?? 0;
    const x = (stageSize.width / fitScale - iw) / 2;
    const y = (stageSize.height / fitScale - ih) / 2;
    return { x, y };
  }, [image, stageSize, fitScale]);

  // === マスク描画（ステージ座標は「スケール前」の論理座標で来る）
  const getRelativePointerSafe = () => {
    const stage = stageRef.current;
    if (!stage?.getRelativePointerPosition) return null;
    const pos = stage.getRelativePointerPosition();
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
    return pos;
    // ここで得られる x/y は scale 適用前の座標系なのでそのまま扱える
  };

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

  // === ダウンロード
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

  const showUiWatermark = String(subscriptionTier || 'free').toLowerCase() === 'free';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar（前面・クリック可） */}
      <div className="p-3 border-b border-gray-200 bg-white relative z-10 pointer-events-auto">
        <div className="flex items-center justify-between">
          {/* 左側：ズームUIは撤去、最低限だけ */}
          <div className="flex items-center space-x-2" />


          {/* 右側：マスク・DL等は従来通り */}
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
                  disabled={!Array.isArray(brushStrokes) || brushStrokes.length === 0}
                  title="すべてのストロークを消去"
                >
                  <Eraser className="h-4 w-4" />
                </Button>
              </>
            )}

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
      <div
        ref={containerRef}
        id="canvas-container"
        className="flex-1 relative overflow-hidden bg-white touch-none"
      >
        {/* プレースホルダー */}
        {!image && !isGenerating && (
          <div className="absolute inset-0 grid place-items-center px-4">
            <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
              <h2 className="text-2xl font-semibold text-gray-900 text-center tracking-tight">
                DRESSUP へようこそ
              </h2>
              <p className="mt-2 text-sm text-gray-600 text-center">
                ✂「編集」に移動
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

        {/* ローディング */}
        {isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mb-4" />
              <p className="text-gray-700">Creating your image...</p>
            </div>
          </div>
        )}

        {/* Konva Stage（fitScale で常にコンテナ内に収める） */}
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          scaleX={fitScale}
          scaleY={fitScale}
          x={0}
          y={0}
          draggable={false} // パン不可（常にフィット）
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: selectedTool === 'mask' ? 'crosshair' : 'default' }}
        >
          <Layer>
            {image && <KonvaImage image={image} x={imageOffset.x} y={imageOffset.y} />}

            {/* 既存マスク（表示切替可能） */}
            {showMasks &&
              Array.isArray(brushStrokes) &&
              brushStrokes.map((stroke) => (
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

            {/* 描画中ストローク */}
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
          {/* === 無料のみ見た目の透かし（保存画像には乗らない） === */}
          {showUiWatermark && image && (
            <Layer listening={false}>
              {/* 右上CTA（クリック不可。リンクにするなら listening を true にし、onClick で PricingDialog を開く） */}
              <Group x={stageSize.width - 240} y={12} listening={false}>
                <Rect width={228} height={32} fill="rgba(16,185,129,0.12)" cornerRadius={8} />
                <Text x={10} y={8} text="透かし解除は ライト以上" fontSize={14} fill="#065f46" />
              </Group>
              {/* 斜めの薄い文字列 */}
              {[-200, 80, 360, 640].map((x, i) => (
                <Text
                  key={i}
                  x={x}
                  y={120 + i * 160}
                  rotation={-30}
                  text="DRESSUPAI.APP — FREE"
                  fontSize={28}
                  opacity={0.15}
                  fill="#000"
                />
              ))}
            </Layer>
          )}
        </Stage>
      </div>

      {/* フッターバー */}
      <div className="p-3 border-t border-gray-200 bg-white">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <div className="flex items-center space-x-4">
            {Array.isArray(brushStrokes) && brushStrokes.length > 0 && (
              <span className="text-yellow-600">
                {brushStrokes.length} brush stroke{brushStrokes.length !== 1 ? 's' : ''}
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
