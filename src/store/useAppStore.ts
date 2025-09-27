// src/store/useAppStore.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

/* ============================================================
 * Types
 * ============================================================ */
export type Tool = 'pan' | 'mask';              // 追加したい場合は 'erase' など拡張可

export type BrushStroke = {
  id: string;
  points: number[];                              // 画像座標系 [x1,y1,x2,y2,...]
  brushSize: number;                             // px
};

export type EditAsset = { id: string; url: string };

export type EditItem = {
  id: string;
  instruction: string;
  parentGenerationId: string | null;
  maskReferenceAsset: string | null;
  outputAssets: EditAsset[];
  timestamp: number;
};

export type Project = {
  id: string;
  name: string;
  edits: EditItem[];
};

type Pan = { x: number; y: number };

/* ============================================================
 * Utils
 * ============================================================ */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const sanitizePan = (p: any): Pan => ({
  x: Number.isFinite(p?.x) ? p.x : 0,
  y: Number.isFinite(p?.y) ? p.y : 0,
});

/* ============================================================
 * Store shape
 * ============================================================ */
export type AppState = {
  // ===== Canvas / View =====
  canvasImage: string | null;
  setCanvasImage: (src: string | null) => void;

  // zoom は 0.1〜3.0。※「数値で保持」必須（persist 復元で文字列化されがち）
  canvasZoom: number;
  setCanvasZoom: (z: number) => void;

  // pan は「スケール前の論理座標」で保持（Stage には pan * zoom を渡す）
  canvasPan: Pan;
  setCanvasPan: (p: Pan) => void;

  // ===== Mask drawing =====
  showMasks: boolean;
  setShowMasks: (v: boolean) => void;

  brushSize: number;
  setBrushSize: (px: number) => void;

  brushStrokes: BrushStroke[];
  addBrushStroke: (s: BrushStroke) => void;
  clearBrushStrokes: () => void;

  selectedTool: Tool;
  setSelectedTool: (t: Tool) => void;

  // ===== Generation / Edit flow =====
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  lastError: string | null;
  setLastError: (m: string | null) => void;

  // ===== Prompt & params（必要に応じて増やせます）=====
  currentPrompt: string;
  setCurrentPrompt: (v: string) => void;

  negativePrompt: string;
  setNegativePrompt: (v: string) => void;

  temperature: number; // 0〜1
  setTemperature: (v: number) => void;

  seed: number | null;
  setSeed: (v: number | null) => void;

  // ===== Project / Edits =====
  currentProject: Project | null;
  setCurrentProject: (p: Project | null) => void;

  upsertEdit: (edit: EditItem) => void;

  selectedEditId: string | null;
  selectEdit: (id: string | null) => void;

  selectedGenerationId: string | null;
  selectGeneration: (id: string | null) => void;

  // ===== Helper =====
  resetView: () => void; // ズーム・パンだけ初期化
  hardReset: () => void; // ほぼ全消し
};

/* ============================================================
 * Store
 * ============================================================ */
export const useAppStore = create<AppState>()(
  persist(
    devtools((set, get) => ({
      /* ===== Canvas / View ===== */
      canvasImage: null,
      setCanvasImage: (src) => set({ canvasImage: src }),

      canvasZoom: 1, // 100%
      setCanvasZoom: (z) => set({ canvasZoom: clamp(num(z, 1), 0.1, 3) }),

      canvasPan: { x: 0, y: 0 },
      setCanvasPan: (p) => set({ canvasPan: sanitizePan(p) }),

      /* ===== Mask drawing ===== */
      showMasks: false,
      setShowMasks: (v) => set({ showMasks: !!v }),

      brushSize: 12,
      setBrushSize: (px) => set({ brushSize: clamp(num(px, 12), 1, 200) }),

      brushStrokes: [],
      addBrushStroke: (s) => set((st) => ({ brushStrokes: [...st.brushStrokes, s] })),
      clearBrushStrokes: () => set({ brushStrokes: [] }),

      selectedTool: 'pan',
      setSelectedTool: (t) => set({ selectedTool: t }),

      /* ===== Generation / Edit flow ===== */
      isGenerating: false,
      setIsGenerating: (v) => set({ isGenerating: !!v }),

      lastError: null,
      setLastError: (m) => set({ lastError: m }),

      /* ===== Prompt & params ===== */
      currentPrompt: '',
      setCurrentPrompt: (v) => set({ currentPrompt: v ?? '' }),

      negativePrompt: '',
      setNegativePrompt: (v) => set({ negativePrompt: v ?? '' }),

      temperature: 0.7,
      setTemperature: (v) => set({ temperature: clamp(num(v, 0.7), 0, 1) }),

      seed: null,
      setSeed: (v) => set({ seed: v === null ? null : Math.trunc(num(v, 0)) }),

      /* ===== Project / Edits ===== */
      currentProject: null,
      setCurrentProject: (p) => set({ currentProject: p }),

      upsertEdit: (edit) => {
        set((st) => {
          const proj = st.currentProject;
          if (!proj) return {};
          const exists = proj.edits.some((e) => e.id === edit.id);
          const next = exists
            ? proj.edits.map((e) => (e.id === edit.id ? edit : e))
            : [...proj.edits, edit];
        // 直近100件で丸める（必要なら変更してください）
          return { currentProject: { ...proj, edits: next.slice(-100) } };
        });
      },

      selectedEditId: null,
      selectEdit: (id) => set({ selectedEditId: id }),

      selectedGenerationId: null,
      selectGeneration: (id) => set({ selectedGenerationId: id }),

      /* ===== Helper ===== */
      resetView: () => set({ canvasZoom: 1, canvasPan: { x: 0, y: 0 } }),
      hardReset: () =>
        set({
          canvasImage: null,
          canvasZoom: 1,
          canvasPan: { x: 0, y: 0 },
          showMasks: false,
          brushSize: 12,
          brushStrokes: [],
          selectedTool: 'pan',
          isGenerating: false,
          lastError: null,
          currentPrompt: '',
          negativePrompt: '',
          // temperature/seed はそのままでもよい
        }),
    })),
    {
      name: 'dressup-store',
      version: 3,
      /**
       * ★ ここが重要：persist 復元で「数値が文字列になっている」事故を全部ケア
       *   - zoom/pan/brushSize/temperature/seed を強制的に数値化
       */
      migrate: (persisted, _from) => {
        try {
          const st = (persisted as any)?.state ?? {};
          if (st) {
            st.canvasZoom = clamp(num(st.canvasZoom, 1), 0.1, 3);
            st.canvasPan = sanitizePan(st.canvasPan ?? { x: 0, y: 0 });
            st.brushSize = clamp(num(st.brushSize, 12), 1, 200);
            st.temperature = clamp(num(st.temperature, 0.7), 0, 1);
            if (st.seed !== null && st.seed !== undefined) {
              const n = Math.trunc(num(st.seed, 0));
              st.seed = Number.isFinite(n) ? n : null;
            }
          }
          return { ...persisted, state: st };
        } catch {
          // 破損時は初期化
          return { version: 3, state: undefined } as any;
        }
      },
      /**
       * 保存対象を必要最小限に（不要なら増減してください）
       */
      partialize: (st) => ({
        canvasImage: st.canvasImage,
        canvasZoom: st.canvasZoom,
        canvasPan: st.canvasPan,
        showMasks: st.showMasks,
        brushSize: st.brushSize,
        brushStrokes: st.brushStrokes,
        selectedTool: st.selectedTool,
        currentProject: st.currentProject,
        currentPrompt: st.currentPrompt,
        negativePrompt: st.negativePrompt,
        temperature: st.temperature,
        seed: st.seed,
      }),
    }
  )
);
