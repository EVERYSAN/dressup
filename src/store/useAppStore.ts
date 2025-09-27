// src/store/useAppStore.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

/* =========
 * Types
 * ========= */
export type BrushStroke = {
  id: string;
  points: number[];      // [x1,y1,x2,y2,...]（画像座標系）
  brushSize: number;     // px
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

type Tool = 'pan' | 'mask';

/* =========
 * Utils
 * ========= */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const toNum = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* =========
 * Store
 * ========= */
export type AppState = {
  /* Canvas image & view */
  canvasImage: string | null;
  setCanvasImage: (src: string | null) => void;

  canvasZoom: number; // 0.1 - 3.0
  setCanvasZoom: (z: number) => void;

  // pan は「スケール前の論理座標」で保持（Stage へは pan * zoom を渡す）
  canvasPan: { x: number; y: number };
  setCanvasPan: (p: { x: number; y: number }) => void;

  /* Mask drawing */
  showMasks: boolean;
  setShowMasks: (v: boolean) => void;

  brushSize: number;
  setBrushSize: (v: number) => void;

  brushStrokes: BrushStroke[];
  addBrushStroke: (s: BrushStroke) => void;
  clearBrushStrokes: () => void;

  selectedTool: Tool;
  setSelectedTool: (t: Tool) => void;

  /* Generation / edit flow flags */
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  /* Prompt / params */
  currentPrompt: string;
  setCurrentPrompt: (v: string) => void;

  temperature: number;          // 0–1
  setTemperature: (v: number) => void;

  seed: number | null;
  setSeed: (v: number | null) => void;

  /* Project / edits */
  currentProject: Project | null;
  setCurrentProject: (p: Project | null) => void;

  upsertEdit: (edit: EditItem) => void;

  /* Selection */
  selectedEditId: string | null;
  selectEdit: (id: string | null) => void;

  selectedGenerationId: string | null;
  selectGeneration: (id: string | null) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    devtools((set, get) => ({
      /* Canvas image & view */
      canvasImage: null,
      setCanvasImage: (src) => set({ canvasImage: src }),

      canvasZoom: 1,
      setCanvasZoom: (z) => set({ canvasZoom: clamp(toNum(z, 1), 0.1, 3) }),

      canvasPan: { x: 0, y: 0 },
      setCanvasPan: (p) =>
        set({
          canvasPan: {
            x: Number.isFinite((p as any)?.x) ? (p as any).x : 0,
            y: Number.isFinite((p as any)?.y) ? (p as any).y : 0,
          },
        }),

      /* Mask drawing */
      showMasks: false,
      setShowMasks: (v) => set({ showMasks: !!v }),

      brushSize: 12,
      setBrushSize: (v) => set({ brushSize: clamp(toNum(v, 12), 1, 200) }),

      brushStrokes: [],
      addBrushStroke: (s) =>
        set((st) => ({
          brushStrokes: [...st.brushStrokes, s],
        })),
      clearBrushStrokes: () => set({ brushStrokes: [] }),

      selectedTool: 'pan',
      setSelectedTool: (t) => set({ selectedTool: t }),

      /* Generation / edit */
      isGenerating: false,
      setIsGenerating: (v) => set({ isGenerating: !!v }),

      /* Prompt / params */
      currentPrompt: '',
      setCurrentPrompt: (v) => set({ currentPrompt: v ?? '' }),

      temperature: 0.7,
      setTemperature: (v) => set({ temperature: clamp(toNum(v, 0.7), 0, 1) }),

      seed: null,
      setSeed: (v) => set({ seed: v === null ? null : Math.trunc(toNum(v, 0)) }),

      /* Project / edits */
      currentProject: null,
      setCurrentProject: (p) => set({ currentProject: p }),

      upsertEdit: (edit) => {
        set((st) => {
          const proj = st.currentProject;
          if (!proj) return {};
          const exists = proj.edits.some((e) => e.id === edit.id);
          const nextEdits = exists
            ? proj.edits.map((e) => (e.id === edit.id ? edit : e))
            : [...proj.edits, edit];

          // 直近100件までに丸める
          const limited = nextEdits.slice(-100);
          return { currentProject: { ...proj, edits: limited } };
        });

        const len = get().currentProject?.edits.length ?? 0;
        console.log(`[DRESSUP][store] edits length = ${len}`);
      },

      /* Selection */
      selectedEditId: null,
      selectEdit: (id) => set({ selectedEditId: id }),

      selectedGenerationId: null,
      selectGeneration: (id) => set({ selectedGenerationId: id }),
    })),
    {
      name: 'dressup-store',
      version: 2,
      // 重要：persist 復元で文字列化された数値を“必ず”数値に戻す
      migrate: (persisted, fromVersion) => {
        try {
          const st = (persisted as any)?.state ?? {};
          if (st) {
            st.canvasZoom = clamp(toNum(st.canvasZoom, 1), 0.1, 3);
            if (!st.canvasPan || typeof st.canvasPan !== 'object') {
              st.canvasPan = { x: 0, y: 0 };
            } else {
              st.canvasPan.x = toNum(st.canvasPan.x, 0);
              st.canvasPan.y = toNum(st.canvasPan.y, 0);
            }
            st.brushSize = clamp(toNum(st.brushSize, 12), 1, 200);
            st.temperature = clamp(toNum(st.temperature, 0.7), 0, 1);
            if (st.seed !== null && st.seed !== undefined) {
              const n = Math.trunc(toNum(st.seed, 0));
              st.seed = Number.isFinite(n) ? n : null;
            }
          }
          return { ...persisted, state: st };
        } catch {
          // 壊れていたら初期化
          return { version: 2, state: undefined } as any;
        }
      },
      // 保存対象を最小限に
      partialize: (st) => ({
        canvasImage: st.canvasImage,
        canvasZoom: st.canvasZoom,
        canvasPan: st.canvasPan,
        showMasks: st.showMasks,
        brushSize: st.brushSize,
        selectedTool: st.selectedTool,
        // 生成フラグやプロンプトはセッション単位で十分なら保存しない
        currentProject: st.currentProject,
        brushStrokes: st.brushStrokes,
      }),
    }
  )
);
