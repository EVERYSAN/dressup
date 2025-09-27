// src/store/useAppStore.ts
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

type Asset = { id: string; url: string };
type GenParams = { seed?: number | null; temperature?: number | null };

export type Generation = {
  id: string;
  prompt: string;
  modelVersion: string;
  timestamp: number;
  sourceAssets: Asset[];   // 参照画像
  outputAssets: Asset[];   // 生成結果（1枚想定）
  parameters: GenParams;
};

export type EditEntry = {
  id: string;
  instruction: string;
  timestamp: number;
  parentGenerationId?: string | null;
  outputAssets: Asset[];
  maskAssetId?: string | null;
  maskReferenceAsset?: Asset | null;
};

type Project = {
  id: string;
  generations: Generation[];
  edits: EditEntry[];
};

type State = {
  // 左パネル
  currentPrompt: string;
  selectedTool: 'generate' | 'edit';
  temperature: number;
  seed: number | null;

  uploadedImages: string[];       // generate 用参照
  editReferenceImages: string[];  // edit 用参照
  canvasImage: string | null;     // 中央の最新1枚

  // パネル表示状態
  showPromptPanel: boolean;
  showHistory: boolean;

  // History / Session
  sessionId: string;
  currentProject: Project | null;
  selectedGenerationId: string | null;
  selectedEditId: string | null;

  // setters / actions
  setCurrentPrompt: (v: string) => void;
  setSelectedTool: (t: State['selectedTool']) => void;
  setTemperature: (t: number) => void;
  setSeed: (s: number | null) => void;

  addUploadedImage: (d: string) => void;
  removeUploadedImage: (i: number) => void;
  clearUploadedImages: () => void;

  addEditReferenceImage: (d: string) => void;
  removeEditReferenceImage: (i: number) => void;
  clearEditReferenceImages: () => void;

  setCanvasImage: (d: string | null) => void;

  setShowPromptPanel: (b: boolean) => void;
  setShowHistory: (b: boolean) => void;

  clearBrushStrokes: () => void; // そのまま残し

  // History:
  ensureProject: () => void;
  addGeneration: (g: Omit<Generation, 'id'|'timestamp'>) => Generation;
  addEdit: (e: Omit<EditEntry, 'id'|'timestamp'>) => EditEntry;
  selectGeneration: (id: string | null) => void;
  selectEdit: (id: string | null) => void;
  clearHistory: () => void;
};

export const useAppStore = create<State>((set, get) => ({
  currentPrompt: '',
  selectedTool: 'generate',
  temperature: 0.7,
  seed: null,

  uploadedImages: [],
  editReferenceImages: [],
  canvasImage: null,

  showPromptPanel: true,
  showHistory: true,

  sessionId: uuidv4(),
  currentProject: { id: uuidv4(), generations: [], edits: [] },
  selectedGenerationId: null,
  selectedEditId: null,

  setCurrentPrompt: (v) => set({ currentPrompt: v }),
  setSelectedTool: (t) => set({ selectedTool: t }),
  setTemperature: (t) => set({ temperature: t }),
  setSeed: (s) => set({ seed: s }),

  addUploadedImage: (d) => set((s) => ({ uploadedImages: [...s.uploadedImages, d].slice(0, 2) })),
  removeUploadedImage: (i) => set((s) => ({ uploadedImages: s.uploadedImages.filter((_, idx) => idx !== i) })),
  clearUploadedImages: () => set({ uploadedImages: [] }),

  addEditReferenceImage: (d) => set((s) => ({ editReferenceImages: [...s.editReferenceImages, d].slice(0, 2) })),
  removeEditReferenceImage: (i) => set((s) => ({ editReferenceImages: s.editReferenceImages.filter((_, idx) => idx !== i) })),
  clearEditReferenceImages: () => set({ editReferenceImages: [] }),

  setCanvasImage: (d) => set({ canvasImage: d }),

  setShowPromptPanel: (b) => set({ showPromptPanel: b }),
  setShowHistory: (b) => set({ showHistory: b }),

  clearBrushStrokes: () => {},

  ensureProject: () => {
    if (!get().currentProject) set({ currentProject: { id: uuidv4(), generations: [], edits: [] } });
  },

  addGeneration: (g) => {
    const gen: Generation = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...g,
    };
    set((s) => {
      const p = s.currentProject ?? { id: uuidv4(), generations: [], edits: [] };
      return {
        currentProject: { ...p, generations: [...p.generations, gen] },
        selectedGenerationId: gen.id,
        selectedEditId: null,
      };
    });
    return gen;
  },

  addEdit: (e) => {
    const ed: EditEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...e,
    };
    set((s) => {
      const p = s.currentProject ?? { id: uuidv4(), generations: [], edits: [] };
      return {
        currentProject: { ...p, edits: [...p.edits, ed] },
        selectedEditId: ed.id,
        selectedGenerationId: null,
      };
    });
    return ed;
  },

  selectGeneration: (id) => set({ selectedGenerationId: id, selectedEditId: null }),
  selectEdit: (id) => set({ selectedEditId: id, selectedGenerationId: null }),

  clearHistory: () => set((s) => ({
    currentProject: s.currentProject ? { ...s.currentProject, generations: [], edits: [] } : s.currentProject,
    selectedEditId: null,
    selectedGenerationId: null,
  })),
}));
