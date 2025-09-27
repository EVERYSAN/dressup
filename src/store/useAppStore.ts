// src/store/useAppStore.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

/* ========= Types ========= */
export type Tool = 'pan' | 'mask';
export type Pan = { x: number; y: number };

export type BrushStroke = {
  id: string;
  points: number[]; // image coordinate [x1,y1,x2,y2,...]
  brushSize: number;
};

export type GenAsset = {
  id: string;
  url: string;
  width?: number;
  height?: number;
  meta?: Record<string, any>;
};

export type HistoryItem = {
  id: string;
  createdAt: number;
  prompt: string;
  negativePrompt?: string;
  seed?: number | null;
  params?: Record<string, any>;
  assets: GenAsset[];
};

export type EditItem = {
  id: string;
  instruction: string;
  parentGenerationId: string | null;
  maskReferenceAsset: string | null;
  outputAssets: GenAsset[];
  timestamp: number;
};

export type Project = {
  id: string;
  name: string;
  edits: EditItem[];
};

/* ========= Utils ========= */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const toNum = (v: unknown, fb: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : Number.isFinite(Number(v))
    ? Number(v)
    : fb;
const toInt = (v: unknown, fb: number) => Math.trunc(toNum(v, fb));
const toBool = (v: unknown, fb = false) =>
  typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fb;

// ← ここがポイント：undefined/null/非文字列でも安全に空文字へ、かつ trim
const safeStr = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();

const sanitizePan = (p: any): Pan => ({
  x: Number.isFinite(p?.x) ? p.x : 0,
  y: Number.isFinite(p?.y) ? p.y : 0,
});

/* ========= Store shape ========= */
export type AppState = {
  // ---- Panels (Left/Right) ----
  sidebarOpen: boolean; // left (new)
  setSidebarOpen: (v: boolean) => void;
  rightPanelOpen: boolean; // right (new)
  setRightPanelOpen: (v: boolean) => void;

  // Backward-compat aliases
  editorOpen: boolean;
  setEditorOpen: (v: boolean) => void;
  isEditorOpen: boolean;
  setIsEditorOpen: (v: boolean) => void;

  historyOpen: boolean;
  setHistoryOpen: (v: boolean) => void;
  isHistoryOpen: boolean;
  setIsHistoryOpen: (v: boolean) => void;

  // Legacy names used by App.tsx
  showPromptPanel: boolean;
  setShowPromptPanel: (v: boolean) => void;
  showHistory: boolean;
  setShowHistory: (v: boolean) => void;

  leftPanelWidth: number; // px
  rightPanelWidth: number; // px
  setLeftPanelWidth: (px: number) => void;
  setRightPanelWidth: (px: number) => void;

  // ---- Canvas / View ----
  canvasImage: string | null; // base image
  refImage: string | null; // reference image
  setCanvasImage: (src: string | null) => void;
  setRefImage: (src: string | null) => void;

  canvasZoom: number; // 0.1–3.0
  setCanvasZoom: (z: number) => void;

  canvasPan: Pan; // pre-scale logical pan
  setCanvasPan: (p: Pan) => void;

  // ---- Mask ----
  selectedTool: Tool;
  setSelectedTool: (t: Tool) => void;
  showMasks: boolean;
  setShowMasks: (v: boolean) => void;
  brushSize: number;
  setBrushSize: (px: number) => void;
  brushStrokes: BrushStroke[];
  addBrushStroke: (s: BrushStroke) => void;
  clearBrushStrokes: () => void;

  // ---- Prompts / Params ----
  instruction: string;
  setInstruction: (v: string) => void;
  negativePrompt: string;
  setNegativePrompt: (v: string) => void;

  cfgScale: number;
  setCfgScale: (v: number) => void;
  steps: number;
  setSteps: (v: number) => void;
  strength: number;
  setStrength: (v: number) => void;
  width: number;
  height: number;
  setSize: (w: number, h: number) => void;
  seed: number | null;
  setSeed: (v: number | null) => void;
  temperature: number;
  setTemperature: (v: number) => void;

  // ---- Generation flow ----
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
  progress: number; // 0–1
  setProgress: (p: number) => void;
  lastError: string | null;
  setLastError: (m: string | null) => void;

  // ---- History / Project ----
  history: HistoryItem[];
  addHistory: (item: HistoryItem) => void;
  clearHistory: () => void;
  selectedHistoryId: string | null;
  selectHistory: (id: string | null) => void;

  currentProject: Project | null;
  setCurrentProject: (p: Project | null) => void;
  upsertEdit: (edit: EditItem) => void;
  selectedEditId: string | null;
  selectEdit: (id: string | null) => void;
  selectedGenerationId: string | null;
  selectGeneration: (id: string | null) => void;

  // ---- Helpers ----
  resetView: () => void;
  hardResetSession: () => void;
};

/* ========= Store ========= */
export const useAppStore = create<AppState>()(
  persist(
    devtools((set, get) => ({
      // ---- Panels ----
      sidebarOpen: true,
      setSidebarOpen: (v) =>
        set({
          sidebarOpen: !!v,
          editorOpen: !!v,
          isEditorOpen: !!v,
          showPromptPanel: !!v,
        }),

      rightPanelOpen: true,
      setRightPanelOpen: (v) =>
        set({
          rightPanelOpen: !!v,
          historyOpen: !!v,
          isHistoryOpen: !!v,
          showHistory: !!v,
        }),

      // Aliases
      editorOpen: true,
      setEditorOpen: (v) =>
        set({
          editorOpen: !!v,
          sidebarOpen: !!v,
          isEditorOpen: !!v,
          showPromptPanel: !!v,
        }),

      isEditorOpen: true,
      setIsEditorOpen: (v) =>
        set({
          isEditorOpen: !!v,
          sidebarOpen: !!v,
          editorOpen: !!v,
          showPromptPanel: !!v,
        }),

      historyOpen: true,
      setHistoryOpen: (v) =>
        set({
          historyOpen: !!v,
          rightPanelOpen: !!v,
          isHistoryOpen: !!v,
          showHistory: !!v,
        }),

      isHistoryOpen: true,
      setIsHistoryOpen: (v) =>
        set({
          isHistoryOpen: !!v,
          rightPanelOpen: !!v,
          historyOpen: !!v,
          showHistory: !!v,
        }),

      // Legacy names used by App.tsx
      showPromptPanel: true,
      setShowPromptPanel: (v) =>
        set({
          showPromptPanel: !!v,
          sidebarOpen: !!v,
          editorOpen: !!v,
          isEditorOpen: !!v,
        }),
      showHistory: true,
      setShowHistory: (v) =>
        set({
          showHistory: !!v,
          rightPanelOpen: !!v,
          historyOpen: !!v,
          isHistoryOpen: !!v,
        }),

      leftPanelWidth: 288,
      rightPanelWidth: 320,
      setLeftPanelWidth: (px) => set({ leftPanelWidth: clamp(toInt(px, 288), 160, 480) }),
      setRightPanelWidth: (px) => set({ rightPanelWidth: clamp(toInt(px, 320), 160, 560) }),

      // ---- Canvas / View ----
      canvasImage: null,
      refImage: null,
      setCanvasImage: (src) => set({ canvasImage: src }),
      setRefImage: (src) => set({ refImage: src }),

      canvasZoom: 1,
      setCanvasZoom: (z) => set({ canvasZoom: clamp(toNum(z, 1), 0.1, 3) }),

      canvasPan: { x: 0, y: 0 },
      setCanvasPan: (p) => set({ canvasPan: sanitizePan(p) }),

      // ---- Mask ----
      selectedTool: 'pan',
      setSelectedTool: (t) => set({ selectedTool: t }),
      showMasks: false,
      setShowMasks: (v) => set({ showMasks: !!v }),
      brushSize: 12,
      setBrushSize: (px) => set({ brushSize: clamp(toNum(px, 12), 1, 200) }),
      brushStrokes: [],
      addBrushStroke: (s) => set((st) => ({ brushStrokes: [...st.brushStrokes, s] })),
      clearBrushStrokes: () => set({ brushStrokes: [] }),

      // ---- Prompts / Params ----
      instruction: '',
      setInstruction: (v) => set({ instruction: safeStr(v) }), // ← trim 安全
      negativePrompt: '',
      setNegativePrompt: (v) => set({ negativePrompt: safeStr(v) }), // ← trim 安全

      cfgScale: 7,
      setCfgScale: (v) => set({ cfgScale: clamp(toNum(v, 7), 0, 30) }),
      steps: 28,
      setSteps: (v) => set({ steps: clamp(toInt(v, 28), 1, 200) }),
      strength: 0.7,
      setStrength: (v) => set({ strength: clamp(toNum(v, 0.7), 0, 1) }),
      width: 1024,
      height: 1024,
      setSize: (w, h) =>
        set({
          width: clamp(toInt(w, 1024), 64, 4096),
          height: clamp(toInt(h, 1024), 64, 4096),
        }),
      seed: null,
      setSeed: (v) => set({ seed: v === null ? null : toInt(v, 0) }),
      temperature: 0.7,
      setTemperature: (v) => set({ temperature: clamp(toNum(v, 0.7), 0, 1) }),

      // ---- Generation ----
      isGenerating: false,
      setIsGenerating: (v) => set({ isGenerating: !!v }),
      progress: 0,
      setProgress: (p) => set({ progress: clamp(toNum(p, 0), 0, 1) }),
      lastError: null,
      setLastError: (m) => set({ lastError: m }),

      // ---- History / Project ----
      history: [],
      addHistory: (item) =>
        set((st) => ({
          history: [...st.history, item].slice(-200),
        })),
      clearHistory: () => set({ history: [] }),
      selectedHistoryId: null,
      selectHistory: (id) => set({ selectedHistoryId: id }),

      currentProject: null,
      setCurrentProject: (p) => set({ currentProject: p }),
      upsertEdit: (edit) =>
        set((st) => {
          const proj = st.currentProject;
          if (!proj) return {};
          const exists = proj.edits.some((e) => e.id === edit.id);
          const next = exists
            ? proj.edits.map((e) => (e.id === edit.id ? edit : e))
            : [...proj.edits, edit];
          return { currentProject: { ...proj, edits: next.slice(-100) } };
        }),
      selectedEditId: null,
      selectEdit: (id) => set({ selectedEditId: id }),
      selectedGenerationId: null,
      selectGeneration: (id) => set({ selectedGenerationId: id }),

      // ---- Helpers ----
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
    })),
    {
      name: 'dressup-store',
      version: 8,
      // Coerce types + ensure strings are trimmed and non-undefined
      migrate: (persisted) => {
        try {
          const st = (persisted as any)?.state ?? {};

          // Panels (default open)
          const leftOpen =
            toBool(st.sidebarOpen, true) ||
            toBool(st.editorOpen, true) ||
            toBool(st.isEditorOpen, true) ||
            toBool(st.showPromptPanel, true);
          st.sidebarOpen = leftOpen;
          st.editorOpen = leftOpen;
          st.isEditorOpen = leftOpen;
          st.showPromptPanel = leftOpen;

          const rightOpen =
            toBool(st.rightPanelOpen, true) ||
            toBool(st.historyOpen, true) ||
            toBool(st.isHistoryOpen, true) ||
            toBool(st.showHistory, true);
          st.rightPanelOpen = rightOpen;
          st.historyOpen = rightOpen;
          st.isHistoryOpen = rightOpen;
          st.showHistory = rightOpen;

          st.leftPanelWidth = clamp(toInt(st.leftPanelWidth ?? 288, 288), 160, 480);
          st.rightPanelWidth = clamp(toInt(st.rightPanelWidth ?? 320, 320), 160, 560);

          // View
          st.canvasZoom = clamp(toNum(st.canvasZoom, 1), 0.1, 3);
          st.canvasPan = sanitizePan(st.canvasPan ?? { x: 0, y: 0 });

          // Mask
          st.showMasks = toBool(st.showMasks, false);
          st.brushSize = clamp(toNum(st.brushSize, 12), 1, 200);

          // Strings must never be undefined and should be trimmed
          st.instruction = safeStr(st.instruction);
          st.negativePrompt = safeStr(st.negativePrompt);

          // Params
          st.cfgScale = clamp(toNum(st.cfgScale, 7), 0, 30);
          st.steps = clamp(toInt(st.steps, 28), 1, 200);
          st.strength = clamp(toNum(st.strength, 0.7), 0, 1);
          st.width = clamp(toInt(st.width, 1024), 64, 4096);
          st.height = clamp(toInt(st.height, 1024), 64, 4096);
          st.temperature = clamp(toNum(st.temperature, 0.7), 0, 1);
          if (st.seed !== null && st.seed !== undefined) {
            const n = toInt(st.seed, 0);
            st.seed = Number.isFinite(n) ? n : null;
          }

          if (!Array.isArray(st.history)) st.history = [];

          return { ...persisted, state: st };
        } catch {
          return { version: 8, state: undefined } as any;
        }
      },
      // Persist only what you need
      partialize: (st) => ({
        // Panels
        sidebarOpen: st.sidebarOpen,
        rightPanelOpen: st.rightPanelOpen,
        editorOpen: st.editorOpen,
        isEditorOpen: st.isEditorOpen,
        historyOpen: st.historyOpen,
        isHistoryOpen: st.isHistoryOpen,
        showPromptPanel: st.showPromptPanel,
        showHistory: st.showHistory,
        leftPanelWidth: st.leftPanelWidth,
        rightPanelWidth: st.rightPanelWidth,

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

        // Params (strings included to keep them trimmed)
        instruction: st.instruction,
        negativePrompt: st.negativePrompt,
        cfgScale: st.cfgScale,
        steps: st.steps,
        strength: st.strength,
        width: st.width,
        height: st.height,
        seed: st.seed,
        temperature: st.temperature,

        // History / Project
        history: st.history,
        currentProject: st.currentProject,
      }),
    }
  )
);
