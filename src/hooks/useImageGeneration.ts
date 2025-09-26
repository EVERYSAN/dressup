import { useMutation } from "@tanstack/react-query";
import geminiService, { fileToDataURL, MaybeFile } from "../services/geminiService";
import { useAppStore } from "../store/useAppStore";

// デバッグ切り替え（必要ならブラウザで localStorage.setItem('DEBUG_DRESSUP','1')）
const DEBUG = () => (typeof window !== "undefined" && localStorage.getItem("DEBUG_DRESSUP") === "1");
const log = (...a: any[]) => { if (DEBUG()) console.log("[DRESSUP][hooks]", ...a); };

// レスポンスから最初の画像を dataURL で取り出す
function extractFirstImageDataURL(resp: any): string | null {
  try {
    const parts = resp?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        const d = p?.inlineData;
        if (d?.data) {
          const mime = d?.mimeType || "image/png";
          return `data:${mime};base64,${d.data}`;
        }
      }
    }
  } catch {}
  return null;
}

/** 画像生成：テキスト+（任意）参照画像 → ギャラリーに追加 */
export function useImageGeneration(): {
  generate: (p: { prompt: string; referenceImages?: (MaybeFile | string)[]; model?: string }) => Promise<any>;
  isPending: boolean;
} {
  log("useImageGeneration() called");
  const { addUploadedImage } = useAppStore();

  const m = useMutation<any, Error, { prompt: string; referenceImages?: (MaybeFile | string)[]; model?: string }>({
    mutationKey: ["generate"],
    mutationFn: async (p) => {
      const refs = p.referenceImages
        ? await Promise.all(
            p.referenceImages.map(async (x) => (typeof x === "string" ? x : await fileToDataURL(x as File)))
          )
        : undefined;

      log("generate start", { promptLen: p.prompt?.length, refCount: refs?.length || 0 });
      const resp = await geminiService.generate({ prompt: p.prompt, referenceImages: refs, model: p.model });
      log("generate resp", resp);

      const dataUrl = extractFirstImageDataURL(resp);
      if (dataUrl) {
        addUploadedImage(dataUrl);
        log("generate image extracted ✓");
      } else {
        console.warn("[DRESSUP] generate: no image in response");
      }
      return resp;
    },
  });

  return { generate: m.mutateAsync, isPending: m.isPending };
}

/** 画像編集：元画像(canvas)＋（任意）参照 → キャンバスを更新 */
export function useImageEditing(): {
  edit: (instruction: string) => Promise<any>;
  isPending: boolean;
} {
  log("useImageEditing() called");
  const { canvasImage, editReferenceImages, setCanvasImage } = useAppStore();

  const m = useMutation<any, Error, string>({
    mutationKey: ["edit-image"],
    mutationFn: async (instruction) => {
      const prompt = instruction?.trim();
      log("edit start", { hasCanvas: !!canvasImage, hasRef: !!(editReferenceImages?.[0]), promptLen: prompt?.length });

      if (!prompt) throw new Error("編集内容（prompt）が空です");
      if (!canvasImage) throw new Error("元画像（canvasImage）が未設定です");

      const resp = await geminiService.edit({
        prompt,
        image1: canvasImage,          // 元画像（dataURL想定）
        image2: editReferenceImages?.[0], // 参照は任意
        mime1: "image/png",
        mime2: "image/png",
      });
      log("edit resp", resp);

      const dataUrl = extractFirstImageDataURL(resp);
      if (dataUrl) {
        setCanvasImage(dataUrl);
        log("edit image extracted ✓");
      } else {
        console.warn("[DRESSUP] edit: no image in response");
      }
      return resp;
    },
  });

  // ★ここが今回の重要ポイント：必ず { edit, isPending } を返す
  return { edit: m.mutateAsync, isPending: m.isPending };
}

export default useImageGeneration;
