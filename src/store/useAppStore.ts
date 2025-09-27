import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/* =========
 * Types
 * ========= */
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
  edits: EditItem[];
  generations?: any[];
};

type AppState = {
  /* Prompt / params */
  currentPrompt: string;
  setCurrentPrompt: (v: string) => void;

  temperature: number;
  setTemperature: (v: number) => void;

  seed: number | null;
  setSeed: (v: number | null) => void;

  /* Side panel / UI */
  showPromptPanel: boolean;
  setShowPromptPanel: (v: boolean) => void;

  showHistory: boolean;
  setShowHistory: (v: boolean) => void;

  /* Canvas */
  canvasImage: string | null;
  setCanvasImage: (url?: string | null) => void;

  /* Mask/brush (将来のために持っておく。今はクリアのみ使用) */
  brushStrokes: any[];
  clearBrushStrokes: () => void;

  /* Edit references (左パネルのRef画像) */
  editReferenceImages: string[];
  addEditReferenceImage: (url: string) => void;
  removeEditReferenceImage: (index: number) => void;
  clearEditReferenceImages: () => void;

  /* Project / History */
  currentProject?: Project;
  ensureProject: () => void;
  addEdit: (edit: EditItem) => void;

  /* Selection */
  selectedEditId: string | null;
  selectEdit: (id: string | null) => void;

  selectedGenerationId: string | null;
  selectGeneration: (id: string | null) => void;
};

/* =========
 * Store
 * ========= */
export const useAppStore = create<AppState>()(
  devtools((set, get) => ({
    /* Prompt / params */
    currentPrompt: '',
    setCurrentPrompt: (v) => set({ currentPrompt: v }),

    temperature: 0.7,
    setTemperature: (v) => set({ temperature: v }),

    seed: null,
    setSeed: (v) => set({ seed: v }),

    /* Side panel / UI */
    showPromptPanel: true,
    setShowPromptPanel: (v) => set({ showPromptPanel: v }),

    showHistory: true,
    setShowHistory: (v) => set({ showHistory: v }),

    /* Canvas */
    canvasImage: null,
    setCanvasImage: (url) => set({ canvasImage: url ?? null }),

    /* Mask/brush */
    brushStrokes: [],
    clearBrushStrokes: () => set({ brushStrokes: [] }),

    /* Edit references */
    editReferenceImages: [],
    addEditReferenceImage: (url) =>
      set((s) => {
        if (s.editReferenceImages.includes(url)) return s;
        // Max 2 refs
        const next = s.editReferenceImages.length >= 2
          ? [s.editReferenceImages[0], url]
          : [...s.editReferenceImages, url];
        return { editReferenceImages: next };
      }),
    removeEditReferenceImage: (index) =>
      set((s) => {
        const next = s.editReferenceImages.slice();
        next.splice(index, 1);
        return { editReferenceImages: next };
      }),
    clearEditReferenceImages: () => set({ editReferenceImages: [] }),

    /* Project / History */
    currentProject: undefined,
    ensureProject: () => {
      set((s) => {
        if (s.currentProject) return s;
        return {
          currentProject: {
            id: 'local-project',
            edits: [],
            generations: [],
          } as Project,
        };
      });
    },

    addEdit: (edit) => {
      set((s) => {
        const proj: Project =
          s.currentProject ?? { id: 'local-project', edits: [], generations: [] };

        const exists = proj.edits.some((e) => e.id === edit.id);
        const nextEdits = exists
          ? proj.edits.map((e) => (e.id === edit.id ? edit : e))
          : [...proj.edits, edit];

        // 直近100件までに丸める（必要に応じて調整）
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
  }))
);
