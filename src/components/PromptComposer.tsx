// src/store/useAppStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * できるだけ v10 の振る舞いを維持するため、state 名や setter 名は既存に合わせています。
 * 追加は zoomIn / zoomOut（＋ setCanvasZoom の安全化）のみ。
 */

/* ========= Utils ========= */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;
const clampZoom = (v: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(v) || 1));
const round2 = (n: number) => Math.round(n * 100) / 100;
const safeNum = (v: unknown, fb: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
};
const safeInt = (v: unknown, fb: number) => Math.trunc(safeNum(v, fb));
const safeBool = (v: unknown, fb = false) =>
  typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fb;
const safeStr = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/* ========= Types（最小限・互換優先のためゆるめ） ========= */
export type BrushStroke = { id: string; points: number[]; brushSize: number };
export type GenAsset = { id: string; url: string; width?: number; height?: number; meta?: Record<string, any> };
export type HistoryItem = { id: string; createdAt: number; prompt: string; negativePrompt?: string; seed?: number | null; params?: Record<string, any>; assets: GenAsset[] };
export type EditItem = { id: string; instruction: string; parentGenerationId: string | null; maskReferenceAsset: string | null; outputAssets: GenAsset[]; timestamp: number };
export type Project = { id: string; name: string; edits: EditItem[] };

export type AppState = {
  // Panels（v10相当）
  showPromptPanel: boolean;
  setShowPromptPanel: (v: boolean) => void;
  showHistory: boolean;
  setShowHistory: (v: boolean) => void;

  // Canvas / View
  canvasImage: string | null;
  refImage: string | null;
  setCanvasImage: (src: string | null) => void;
  setRefImage: (src: string | null) => void;

  canvasZoom: number;                // 0.1–3.0
  setCanvasZoom: (z: number) => void;
  zoomIn: () => void;                // ★ 追加
  zoomOut: () => void;               // ★ 追加

  canvasPan: { x: number; y: number };
  setCanvasPan: (p: { x: number; y: number }) => void;

  // Mask
  selectedTool: 'pan' | 'mask';
  setSelectedTool: (t: 'pan' | 'mask') => void;
  showMasks: boolean;
  setShowMasks: (v: boolean) => void;
  brushSize: number;
  setBrushSize: (px: number) => void;
  brushStrokes: BrushStroke[];
  addBrushStroke: (s: BrushStroke) => void;
  clearBrushStrokes: () => void;

  // Prompts / Params（v10で使われていた可能性のある名称を維持）
  currentPrompt: string;
  setCurrentPrompt: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  instruction: string;
  setInstruction: (v: string) => void;

  negativePrompt: string;
  setNegativePrompt: (v: string) => void;

  temperature: number;
  setTemperature: (v: number) => void;
  seed: number | null;
  setSeed: (v: number | null) => void;

  // Generation / flow
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
  progress: number;
  setProgress: (p: number) => void;
  lastError: string | null;
  setLastError: (m: string | null) => void;

  // History / Project
  history: HistoryItem[];
  addHistory: (item: HistoryItem) => void;
  clearHistory: () => void;

  currentProject: Project | null;
  setCurrentProject: (p: Project | null) => void;
  upsertEdit: (edit: EditItem) => void;

  selectedHistoryId: string | null;
  selectHistory: (id: string | null) => void;
  selectedEditId: string | null;
  selectEdit: (id: string | null) => void;
  selectedGenerationId: string | null;
  selectGeneration: (id: string | null) => void;

  // Helpers
  resetView: () => void;
  hardResetSession: () => void;
};

/* ========= Store ========= */
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      /* --- Panels --- */
      showPromptPanel: true,
      setShowPromptPanel: (v) => set({ showPromptPanel: !!v }),
      showHistory: true,
      setShowHistory: (v) => set({ showHistory: !!v }),

      /* --- Canvas / View --- */
      canvasImage: null,
      refImage: null,
      setCanvasImage: (src) => set({ canvasImage: src }),
      setRefImage: (src) => set({ refImage: src }),

      canvasZoom: 1,
      setCanvasZoom: (z) => set({ canvasZoom: clampZoom(z) }),
      // ★ 追加: ＋/− ズーム（既存を壊さない）
      zoomIn: () => set((st) => ({ canvasZoom: clampZoom(round2((st.canvasZoom ?? 1) + ZOOM_STEP)) })),
      zoomOut: () => set((st) => ({ canvasZoom: clampZoom(round2((st.canvasZoom ?? 1) - ZOOM_STEP)) })),

      canvasPan: { x: 0, y: 0 },
      setCanvasPan: (p) =>
        set({
          canvasPan: {
            x: Number.isFinite((p as any)?.x) ? (p as any).x : 0,
            y: Number.isFinite((p as any)?.y) ? (p as any).y : 0,
          },
        }),

      /* --- Mask --- */
      selectedTool: 'pan',
      setSelectedTool: (t) => set({ selectedTool: t }),
      showMasks: false,
      setShowMasks: (v) => set({ showMasks: !!v }),
      brushSize: 12,
      setBrushSize: (px) => set({ brushSize: Math.max(1, Math.min(200, safeInt(px, 12))) }),
      brushStrokes: [],
      addBrushStroke: (s) => set((st) => ({ brushStrokes: [...st.brushStrokes, s] })),
      clearBrushStrokes: () => set({ brushStrokes: [] }),

      /* --- Prompts / Params --- */
      currentPrompt: '',
      setCurrentPrompt: (v) => {
        const s = safeStr(v);
        set({ currentPrompt: s, prompt: s, instruction: s });
      },
      prompt: '',
      setPrompt: (v) => {
        const s = safeStr(v);
        set({ currentPrompt: s, prompt: s, instruction: s });
      },
      instruction: '',
      setInstruction: (v) => {
        const s = safeStr(v);
        set({ currentPrompt: s, prompt: s, instruction: s });
      },

      negativePrompt: '',
      setNegativePrompt: (v) => set({ negativePrompt: safeStr(v) }),

      temperature: 0.7,
      setTemperature: (v) => set({ temperature: Math.max(0, Math.min(1, safeNum(v, 0.7))) }),
      seed: null,
      setSeed: (v) => set({ seed: v === null ? null : safeInt(v, 0) }),

      /* --- Generation / flow --- */
      isGenerating: false,
      setIsGenerating: (v) => set({ isGenerating: !!v }),
      progress: 0,
      setProgress: (p) => set({ progress: Math.max(0, Math.min(1, safeNum(p, 0))) }),
      lastError: null,
      setLastError: (m) => set({ lastError: m == null ? null : String(m) }),

      /* --- History / Project --- */
      history: [],
      addHistory: (item) => set((st) => ({ history: [...st.history, item].slice(-200) })),
      clearHistory: () => set({ history: [] }),

      currentProject: null,
      setCurrentProject: (p) => set({ currentProject: p }),
      upsertEdit: (edit) =>
        set((st) => {
          const proj = st.currentProject;
          if (!proj) return {};
          const exists = proj.edits.some((e) => e.id === edit.id);
          const next = exists ? proj.edits.map((e) => (e.id === edit.id ? edit : e)) : [...proj.edits, edit];
          return { currentProject: { ...proj, edits: next.slice(-100) } };
        }),

      selectedHistoryId: null,
      selectHistory: (id) => set({ selectedHistoryId: id }),
      selectedEditId: null,
      selectEdit: (id) => set({ selectedEditId: id }),
      selectedGenerationId: null,
      selectGeneration: (id) => set({ selectedGenerationId: id }),

      /* --- Helpers --- */
      resetView: () => set({ canvasZoom: 1, canvasPan: { x: 0, y: 0 } }),
      hardResetSession: () =>
        set({
          canvasZoom: 1,
          canvasPan: { x: 0, y: 0 },
          showMasks: false,
          brushStrokes: [],
          selectedTool: 'pan',
          isGenerating: false,
          progress: 0,
          lastError: null,
          selectedHistoryId: null,
          selectedEditId: null,
          selectedGenerationId: null,
        }),
    }),
    {
      name: 'dressup-store',
      // v10に寄せて、余計な migrate はしない（= 既存の状態をできるだけそのまま保持）
      partialize: (st) => ({
        // Panels
        showPromptPanel: st.showPromptPanel,
        showHistory: st.showHistory,

        // View
        canvasImage: st.canvasImage,
        refImage: st.refImage,
        canvasZoom: st.canvasZoom,
        canvasPan: st.canvasPan,

        // Mask
        selectedTool: st.selectedTool,
        showMasks: st.showMasks,
        brushSize: st.brushSize,
        brushStrokes: st.brushStrokes,

        // Prompts / Params
        currentPrompt: st.currentPrompt,
        prompt: st.prompt,
        instruction: st.instruction,
        negativePrompt: st.negativePrompt,
        temperature: st.temperature,
        seed: st.seed,

        // History / Project
        history: st.history,
        currentProject: st.currentProject,
        selectedHistoryId: st.selectedHistoryId,
        selectedEditId: st.selectedEditId,
        selectedGenerationId: st.selectedGenerationId,
      }),
    }
  )
);
