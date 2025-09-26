// src/hooks/useImageGeneration.ts
import { useMutation } from "@tanstack/react-query";
import geminiService, { fileToDataURL, MaybeFile } from "../services/geminiService";
import { useAppStore } from "../store/useAppStore";

const DEBUG = () =>
  (typeof window !== 'undefined' && (localStorage.getItem('DEBUG_DRESSUP') === '1'));

// レスポンスから画像データ(DataURL)を robust に抽出
function extractImageDataURL(resp: any): string | null {
  try {
    // 典型: candidates[0].content.parts[].inlineData.{mimeType,data}
    const parts = resp?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        const d = p?.inlineData;
        if (d?.data) {
          const mime = d?.mimeType || 'image/png';
          return `data:${mime};base64,${d.data}`;
        }
        // 念のため fileData 系にも対応（将来拡張用）
        const f = p?.fileData;
        if (f?.fileUri) {
          // fileUri の場合は別ダウンロードが要るが、まずはログ
          if (DEBUG()) console.warn('[DRESSUP] fileUri found (not auto-fetching):', f.fileUri);
        }
      }
    }
  } catch (e) {
    // noop
  }
  return null;
}

// ---------- 生成 ----------
export function useImageGeneration() {
  const { addUploadedImage } = useAppStore();

  return useMutation<any, Error, { prompt: string; referenceImages?: (MaybeFile | string)[]; model?: string }>({
    mutationKey: ["generate"],
    mutationFn: async (p) => {
      const refs = p.referenceImages
        ? await Promise.all(
            p.referenceImages.map(async (x) =>
              typeof x === "string" ? x : await fileToDataURL(x as File)
            )
          )
        : undefined;
      if (DEBUG()) console.log('[DRESSUP][gen] start', { prompt: p.prompt, refCount: refs?.length || 0 });
      const resp = await geminiService.generate({ prompt: p.prompt, referenceImages: refs, model: p.model });
      if (DEBUG()) console.log('[DRESSUP][gen] resp', resp);

      const dataUrl = extractImageDataURL(resp);
      if (dataUrl) {
        addUploadedImage(dataUrl); // 生成結果をギャラリー側に追加
      } else {
        console.warn('[DRESSUP][gen] no image in response');
      }
      return resp;
    },
  });
}

// ---------- 編集 ----------
export function useImageEditing() {
  const { canvasImage, editReferenceImages, setCanvasImage } = useAppStore();

  return useMutation<any, Error, string>({
    mutationKey: ["edit-image"],
    mutationFn: async (instruction) => {
      if (!instruction?.trim()) throw new Error("編集内容（prompt）が空です");
      if (!canvasImage) throw new Error("元画像（canvasImage）が未設定です");
      const img2 = editReferenceImages?.[0];

      if (DEBUG()) console.log('[DRESSUP][edit] start', { instruction, hasImg1: !!canvasImage, hasImg2: !!img2 });
      const resp = await geminiService.editImage({
        prompt: instruction.trim(),
        image1: canvasImage,
        image2: img2,
        mime1: "image/png",
        mime2: "image/png",
      });
      if (DEBUG()) console.log('[DRESSUP][edit] resp', resp);

      const dataUrl = extractImageDataURL(resp);
      if (dataUrl) {
        setCanvasImage(dataUrl); // 編集結果でキャンバス更新
      } else {
        console.warn('[DRESSUP][edit] no image in response');
      }
      return resp;
    },
  });
}

export default useImageGeneration;
