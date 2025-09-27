// src/hooks/useImageGeneration.ts
import { useMutation } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';

const DEBUG = () => typeof window !== 'undefined' && localStorage.getItem('DEBUG_DRESSUP') === '1';

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return (await res.json()) as T;
}

function extractImage(resp: any): { dataUrl?: string; model?: string } {
  const model = resp?.modelVersion || resp?.model || '';
  const parts = resp?.candidates?.[0]?.content?.parts;
  const img = parts?.find((p: any) => p?.inlineData?.data)?.inlineData;
  if (img?.data) {
    const mime = img?.mimeType || 'image/png';
    return { dataUrl: `data:${mime};base64,${img.data}`, model };
  }
  return { model };
}

/* -------- Generate -------- */
type GenerateArgs = { prompt: string; referenceImages?: string[]; model?: string };

export function useImageGeneration() {
  const {
    addGeneration, setCanvasImage, temperature, seed,
  } = useAppStore();

  const m = useMutation<any, Error, GenerateArgs>({
    mutationKey: ['generate'],
    mutationFn: async ({ prompt, referenceImages, model }) => {
      const p = prompt.trim();
      if (!p) throw new Error('prompt が空です');
      DEBUG() && console.debug('[GEN] /api/generate', { p, refs: referenceImages?.length || 0, model });

      const resp = await postJSON<any>('/api/generate', { prompt: p, referenceImages, model });
      const { dataUrl, model: mv } = extractImage(resp);

      if (dataUrl) {
        setCanvasImage(dataUrl); // 中央を置換
        // 履歴に積む
        addGeneration({
          prompt: p,
          modelVersion: mv || 'gemini-2.5-flash-image-preview',
          sourceAssets: (referenceImages || []).map((url, i) => ({ id: `ref-${Date.now()}-${i}`, url })),
          outputAssets: [{ id: `gen-${Date.now()}`, url: dataUrl }],
          parameters: { temperature, seed },
        });
      } else {
        console.warn('[GEN] no image in response');
      }
      return resp;
    },
  });

  return { generate: m.mutateAsync, isPending: m.isPending };
}

/* -------- Edit -------- */
export function useImageEditing() {
  const {
    canvasImage, editReferenceImages, setCanvasImage, addEdit, selectedGenerationId,
  } = useAppStore();

  const m = useMutation<any, Error, string>({
    mutationKey: ['edit'],
    mutationFn: async (instruction) => {
      const prompt = instruction.trim();
      if (!prompt) throw new Error('編集内容（prompt）が空です');
      if (!canvasImage) throw new Error('元画像がありません');

      const ref = editReferenceImages.find((r) => r && r !== canvasImage);
      DEBUG() && console.debug('[EDIT] /api/edit', { hasBase: !!canvasImage, hasRef: !!ref });

      const resp = await postJSON<any>('/api/edit', { prompt, image1: canvasImage, image2: ref || undefined });
      const { dataUrl } = extractImage(resp);

      if (dataUrl) {
        setCanvasImage(dataUrl); // 中央を置換
        addEdit({
          instruction: prompt,
          parentGenerationId: selectedGenerationId,
          outputAssets: [{ id: `edit-${Date.now()}`, url: dataUrl }],
          maskAssetId: null,
          maskReferenceAsset: ref ? { id: `maskref-${Date.now()}`, url: ref } : null,
        });
      } else {
        console.warn('[EDIT] no image in response');
      }
      return resp;
    },
  });

  return { edit: m.mutateAsync, isPending: m.isPending };
}

export default useImageGeneration;
