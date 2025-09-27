// src/store/useAppStore.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

/* ============================================================
 * Types
 * ============================================================ */
export type Tool = 'pan' | 'mask';

export type Pan = { x: number; y: number };

export type BrushStroke = {
  id: string;
  points: number[];      // 画像座標系 [x1,y1,x2,y2,...]
  brushSize: number;     // px
};

export type GenAsset = {
  id: string;
  url: string;           // blob/data/http
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
  maskReferenceAsset: string | null; // 画像に紐づくマスクIDなど
  outputAssets: GenAsset[];
  timestamp: number;
};

export type Project = {
  id: string;
  name: string;
  edits: EditItem[];
};

export type AppTheme = 'light' | 'dark';

/* ============================================================
 * Utils
 * ============================================================ */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const toNum = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const toInt = (v: unknown, fallback: number) => Math.trunc(toNum(v, fallback));
const bool = (v: unknown, fallback = false) =>
  typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback;

const sanitizePan = (p: any): Pan => ({
  x: Number.isFinite(p?.x) ? p.x : 0,
  y: Number.isFinite(p?.y) ? p.y : 0,
});

/* ============================================================
 * Store shape
 * ============================================================ */
export type AppState = {
  /* ===== App / UI chrome ===== */
  versionLabel: string;                 // 例: "1.0"
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;

  sidebarOpen: boolean;                 // 左ペイン（編集）
  setSidebarOpen: (v: boolean) => void;

  rightPanelOpen: boolean;              // 右ペイン（History）
  setRightPanelOpen: (v: boolean) => void;

  /* ===== Canvas / View ===== */
  canvasImage: string | null;           // ベース画像（1枚目）
  refImage: string | null;              // 参照画像（2枚目）
  setCanvasImage: (src: string | null) => void;
  setRefImage: (src: string | null) => void;

  // ※ズームは 0.1〜3.0。必ず number で保持（persist 復元で文字列化対策あり）
  canvasZoom: number;
  setCanvasZoom: (z: number) => void;

  // pan は「スケール前の論理座標」で保持（Stage には pan * zoom を渡す）
  canvasPan: Pan;
  setCanvasPan: (p: Pan) => void;

  /* ===== Mask drawing ===== */
  selectedTool: Tool;
  setSelectedTool: (t: Tool) => void;

  showMasks: boolean;
  setShowMasks: (v: boolean) => void;

  brushSize: number;
  setBrushSize: (px: number) => void;

  brushStrokes: BrushStroke[];
  addBrushStroke: (s: BrushStroke) => void;
  clearBrushStrokes: () => void;

  /* ===== Prompt & parameters（エディタ） ===== */
  instruction: string;                  // 「変更内容の指示」テキスト
  setInstruction: (v: string) => void;

  negativePrompt: string;
  setNegativePrompt: (v: string) => void;

  // 画像生成パラメータ（必要に応じて UI と同期）
  cfgScale: number;     // guidance scale
  setCfgScale: (v: number) => void;

  steps: number;
  setSteps: (v: number) => void;

  strength: number;     // img2img strength
  setStrength: (v: number) => void;

  width: number;
  height: number;
  setSize: (w: number, h: number) => void;

  seed: number | null;
  setSeed: (v: number | null) => void;

  temperature: number; // 0〜1（文生成系で使う場合に備え）
  setTemperature: (v: number) => void;

  /* ===== Generation flow ===== */
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  progress: number;     // 0〜1
  setProgress: (p: number) => void;

  lastError: string | null;
  setLastError: (m: string | null) => void;

  /* ===== History / Project ===== */
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

  /* ===== Helpers ===== */
  resetView: () => void;                // ズーム・パンのみ初期化
  hardResetSession: () => void;         // セッション系を初期化（画像や指示は残す）
};

/* ============================================================
 * Store
 * ============================================================ */
export const useAppStore = create<AppState>()(
  persist(
    devtools((set, get) => ({
      /* ===== App / UI chrome ===== */
      versionLabel: '1.0',
      theme: 'light',
      setTheme: (t) => set({ theme: t }),

      sidebarOpen: true,
      setSidebarOpen: (v) => set({ sidebarOpen: !!v }),

      rightPanelOpen: true,
      setRightPanelOpen: (v) => set({ rightPanelOpen: !!v }),

      /* ===== Canvas / View ===== */
      canvasImage: null,
      refImage: null,
      setCanvasImage: (src) => set({ canvasImage: src }),
      setRefImage: (src) => set({ refImage: src }),

      canvasZoom: 1, // 100%
      setCanvasZoom: (z) => set({ canvasZoom: clamp(toNum(z, 1), 0.1, 3) }),

      canvasPan: { x: 0, y: 0 },
      setCanvasPan: (p) => set({ canvasPan: sanitizePan(p) }),

      /* ===== Mask drawing ===== */
      selectedTool: 'pan',
      setSelectedTool: (t) => set({ selectedTool: t }),

      showMasks: false,
      setShowMasks: (v) => set({ showMasks: !!v }),

      brushSize: 12,
      setBrushSize: (px) => set({ brushSize: clamp(toNum(px, 12), 1, 200) }),

      brushStrokes: [],
      addBrushStroke: (s) => set((st) => ({ brushStrokes: [...st.brushStrokes, s] })),
      clearBrushStrokes: () => set({ brushStrokes: [] }),

      /* ===== Prompt & params ===== */
      instruction: '',
      setInstruction: (v) => set({ instruction: v ?? '' }),

      negativePrompt: '',
      setNegativePrompt: (v) => set({ negativePrompt: v ?? '' }),

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

      /* ===== Generation flow ===== */
      isGenerating: false,
      setIsGenerating: (v) => set({ isGenerating: !!v }),

      progress: 0,
      setProgress: (p) => set({ progress: clamp(toNum(p, 0), 0, 1) }),

      lastError: null,
      setLastError: (m) => set({ lastError: m }),

      /* ===== History / Project ===== */
      history: [],
      addHistory: (item) =>
        set((st) => ({
          history: [...st.history, item].slice(-200), // 直近200件
        })),
      clearHistory: () => set({ history: [] }),

      selectedHistoryId: null,
      selectHistory: (id) => set({ selectedHistoryId: id }),

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
          return { currentProject: { ...proj, edits: next.slice(-100) } };
        });
      },

      selectedEditId: null,
      selectEdit: (id) => set({ selectedEditId: id }),

      selectedGenerationId: null,
      selectGeneration: (id) => set({ selectedGenerationId: id }),

      /* ===== Helpers ===== */
      resetView: () => set({ canvasZoom: 1, canvasPan: { x: 0, y: 0 } }),
      hardResetSession: () =>
        set({
          // 画像は残すが、セッション的な状態をクリア
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
      version: 5,
      /**
       * ★ 重要：persist 復元での型崩れを全面ケア
       *    - number が "1" など文字列で戻っても強制的に数値化
       *    - pan の欠損/NaN を補正
       */
      migrate: (persisted) => {
        try {
          const st = (persisted as any)?.state ?? {};
          if (st) {
            // UI
            st.theme = (st.theme === 'dark' ? 'dark' : 'light') as AppTheme;
            st.sidebarOpen = bool(st.sidebarOpen, true);
            st.rightPanelOpen = bool(st.rightPanelOpen, true);

            // View
            st.canvasZoom = clamp(toNum(st.canvasZoom, 1), 0.1, 3);
            st.canvasPan = sanitizePan(st.canvasPan ?? { x: 0, y: 0 });

            // Mask
            st.showMasks = bool(st.showMasks, false);
            st.brushSize = clamp(toNum(st.brushSize, 12), 1, 200);

            // Prompts/params
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

            // History safety
            if (!Array.isArray(st.history)) st.history = [];
          }
          return { ...persisted, state: st };
        } catch {
          return { version: 5, state: undefined } as any;
        }
      },
      // 保存対象を必要最小限に
      partialize: (st) => ({
        // UI
        versionLabel: st.versionLabel,
        theme: st.theme,
        sidebarOpen: st.sidebarOpen,
        rightPanelOpen: st.rightPanelOpen,

        // View
        canvasImage: st.canvasImage,
        refImage: st.refImage,
        canvasZoom: st.canvasZoom,
        canvasPan: st.canvasPan,

        // Mask
        showMasks: st.showMasks,
        brushSize: st.brushSize,
        brushStrokes: st.brushStrokes,
        selectedTool: st.selectedTool,

        // Prompts/params
        instruction: st.instruction,
        negativePrompt: st.negativePrompt,
        cfgScale: st.cfgScale,
        steps: st.steps,
        strength: st.strength,
        width: st.width,
        height: st.height,
        seed: st.seed,
        temperature: st.temperature,

        // Project / history
        history: st.history,
        currentProject: st.currentProject,
      }),
    }
  )
);
