import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ===== 履歴の型 =====
export type OutputAsset = { id: string; url: string };

export type GenerationItem = {
  id: string;
  prompt: string;
  modelVersion: string;
  parameters?: { seed?: number | null };
  sourceAssets: OutputAsset[];
  outputAssets: OutputAsset[];
  timestamp: number;
};

export type EditItem = {
  id: string;
  instruction: string;
  parentGenerationId?: string | null;
  maskReferenceAsset?: OutputAsset | null;
  outputAssets: OutputAsset[];
  timestamp: number;
};

export type ProjectState = {
  id: string;
  generations: GenerationItem[];
  edits: EditItem[];
};

// ===== マスク（今は非活性だが型は保持） =====
export type BrushStroke = {
  id: string;
  points: number[];     // [x1,y1,x2,y2,...]
  brushSize: number;
};

type CanvasPan = { x: number; y: number };

// ===== ストア =====
type AppState = {
  // Prompt / モード
  currentPrompt: string;
  setCurrentPrompt: (v: string) => void;

  selectedTool: 'generate' | 'edit';
  setSelectedTool: (v: 'generate' | 'edit') => void;

  temperature: number;
  setTemperature: (v: number) => void;

  seed: number | null;
  setSeed: (v: number | null) => void;

  // 生成用アップロード
  uploadedImages: string[];
  addUploadedImage: (dataUrl: string) => void;
  removeUploadedImage: (index: number) => void;
  clearUploadedImages: () => void;

  // 編集用アップロード（BASE は PromptComposer 側で管理）
  editReferenceImages: string[];
  addEditReferenceImage: (dataUrl: string) => void;
  removeEditReferenceImage: (index: number) => void;
  clearEditReferenceImages: () => void;

  // キャンバス表示
  canvasImage: string | null;
  setCanvasImage: (url: string | null) => void;

  // キャンバス操作（ズーム/パン/マスク）
  canvasZoom: number;
  setCanvasZoom: (z: number) => void;
  canvasPan: CanvasPan;
  setCanvasPan: (p: CanvasPan) => void;

  showMasks: boolean;
  setShowMasks: (v: boolean) => void;

  brushStrokes: BrushStroke[];
  addBrushStroke: (s: BrushStroke) => void;
  clearBrushStrokes: () => void;

  // パネル表示
  showPromptPanel: boolean;
  setShowPromptPanel: (v: boolean) => void;

  // ===== 履歴管理 =====
  currentProject: ProjectState | null;
  ensureProject: () => void;

  addGeneration: (g: GenerationItem) => void;
  addEdit: (e: EditItem) => void;

  selectedGenerationId: string | null;
  selectedEditId: string | null;
  selectGeneration: (id: string | null) => void;
  selectEdit: (id: string | null) => void;

  showHistory: boolean;
  setShowHistory: (v: boolean) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ---- 初期値 ----
      currentPrompt: '',
      setCurrentPrompt: (v) => set({ currentPrompt: v }),

      selectedTool: 'edit',
      setSelectedTool: (v) => set({ selectedTool: v }),

      temperature: 0.7,
      setTemperature: (v) => set({ temperature: v }),

      seed: null,
      setSeed: (v) => set({ seed: v }),

      uploadedImages: [],
      addUploadedImage: (u) => set((s) => ({ uploadedImages: [...s.uploadedImages, u] })),
      removeUploadedImage: (idx) =>
        set((s) => ({ uploadedImages: s.uploadedImages.filter((_, i) => i !== idx) })),
      clearUploadedImages: () => set({ uploadedImages: [] }),

      editReferenceImages: [],
      addEditReferenceImage: (u) => set((s) => ({ editReferenceImages: [...s.editReferenceImages, u] })),
      removeEditReferenceImage: (idx) =>
        set((s) => ({ editReferenceImages: s.editReferenceImages.filter((_, i) => i !== idx) })),
      clearEditReferenceImages: () => set({ editReferenceImages: [] }),

      canvasImage: null,
      setCanvasImage: (url) => set({ canvasImage: url }),

      canvasZoom: 1,
      setCanvasZoom: (z) => set({ canvasZoom: z }),
      canvasPan: { x: 0, y: 0 },
      setCanvasPan: (p) => set({ canvasPan: p }),

      showMasks: false,
      setShowMasks: (v) => set({ showMasks: v }),

      brushStrokes: [],
      addBrushStroke: (s) => set((st) => ({ brushStrokes: [...st.brushStrokes, s] })),
      clearBrushStrokes: () => set({ brushStrokes: [] }),

      showPromptPanel: true,
      setShowPromptPanel: (v) => set({ showPromptPanel: v }),

      // ===== 履歴 =====
      currentProject: null,
      ensureProject: () => {
        const s = get();
        if (!s.currentProject) {
          set({
            currentProject: { id: `proj-${Date.now()}`, generations: [], edits: [] },
          });
        }
      },

      addGeneration: (g) => {
        const s = get();
        if (!s.currentProject) {
          s.ensureProject();
        }
        set((st) => ({
          currentProject: st.currentProject
            ? { ...st.currentProject, generations: [g, ...st.currentProject.generations] }
            : { id: `proj-${Date.now()}`, generations: [g], edits: [] },
        }));
      },

      addEdit: (e) => {
        const s = get();
        if (!s.currentProject) {
          s.ensureProject();
        }
        set((st) => ({
          currentProject: st.currentProject
            ? { ...st.currentProject, edits: [e, ...st.currentProject.edits] }
            : { id: `proj-${Date.now()}`, generations: [], edits: [e] },
        }));
      },

      selectedGenerationId: null,
      selectedEditId: null,
      selectGeneration: (id) => set({ selectedGenerationId: id, selectedEditId: null }),
      selectEdit: (id) => set({ selectedEditId: id, selectedGenerationId: null }),

      showHistory: true,
      setShowHistory: (v) => set({ showHistory: v }),
    }),
    {
      name: 'dressup-app-store', // LocalStorage key
      partialize: (state) => ({
        // 永続化したいものだけ
        temperature: state.temperature,
        seed: state.seed,
        uploadedImages: state.uploadedImages,
        editReferenceImages: state.editReferenceImages,
        currentProject: state.currentProject,
        showHistory: state.showHistory,
      }),
    }
  )
);
