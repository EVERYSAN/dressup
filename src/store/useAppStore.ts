// ---- 追記: 型（ファイル先頭の import 群の下など）------------------
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
// -------------------------------------------------------------------


// ---- 追記: create(...) の state に追加 ------------------------------
currentProject: null as ProjectState | null,

selectedGenerationId: null as string | null,
selectedEditId: null as string | null,

showHistory: true,
// -------------------------------------------------------------------


// ---- 追記: actions を追加 ------------------------------------------
ensureProject: () => {
  const s = get();
  if (!s.currentProject) {
    set({
      currentProject: {
        id: `proj-${Date.now()}`,
        generations: [],
        edits: [],
      },
    });
  }
},

addGeneration: (g: GenerationItem) => {
  const s = get();
  if (!s.currentProject) {
    get().ensureProject();
  }
  set((st) => ({
    currentProject: st.currentProject
      ? { ...st.currentProject, generations: [g, ...st.currentProject.generations] }
      : { id: `proj-${Date.now()}`, generations: [g], edits: [] },
  }));
},

addEdit: (e: EditItem) => {
  const s = get();
  if (!s.currentProject) {
    get().ensureProject();
  }
  set((st) => ({
    currentProject: st.currentProject
      ? { ...st.currentProject, edits: [e, ...st.currentProject.edits] }
      : { id: `proj-${Date.now()}`, generations: [], edits: [e] },
  }));
},

selectGeneration: (id: string | null) => set({ selectedGenerationId: id, selectedEditId: null }),
selectEdit: (id: string | null) => set({ selectedEditId: id, selectedGenerationId: null }),

setShowHistory: (v: boolean) => set({ showHistory: v }),
// -------------------------------------------------------------------
