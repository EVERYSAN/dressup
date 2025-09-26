// src/hooks/useImageGeneration.ts
import { useMutation } from "@tanstack/react-query";
import geminiService, { fileToDataURL, MaybeFile } from "../services/geminiService";
import { useAppStore } from "../store/useAppStore";

/** Debug toggle: `localStorage.setItem('DEBUG_DRESSUP','1')` */
const DEBUG = () => (typeof window !== "undefined" && localStorage.getItem("DEBUG_DRESSUP") === "1");
const log = (...a: any[]) => { if (DEBUG()) console.log("[DRESSUP][hooks]", ...a); };

/* ----------------------------- utils ----------------------------- */

/** URL→dataURL（直fetch→CORS失敗時は /api/fetch-file にフォールバック） */
async function fetchAsDataURL(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string>((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.readAsDataURL(blob);
    });
  } catch {
    try {
      const r = await fetch(`/api/fetch-file?url=${encodeURIComponent(url)}`);
      if (!r.ok) return null;
      const j = await r.json();
      return j?.dataUrl || null;
    } catch {
      return null;
    }
  }
}

/** モデル応答から最初の画像 or テキストを取り出す（inlineData/fileUri/textに対応） */
async function resolveOutputFromResponse(resp: any): Promise<{ dataUrl?: string; text?: string }> {
  try {
    const parts = resp?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return {};
    // 1) inlineData（最優先）
    for (const p of parts) {
      const d = p?.inlineData;
      if (d?.data) {
        const mime = d?.mimeType || "image/png";
        return { dataUrl: `data:${mime};base64,${d.data}` };
      }
    }
    // 2) fileUri などURL系
    for (const p of parts) {
      const uri: string | undefined = p?.fileData?.fileUri || p?.media?.url || p?.imageUrl;
      if (uri && /^https?:\/\//.test(uri)) {
        const dataUrl = await fetchAsDataURL(uri);
        if (dataUrl) return { dataUrl };
      }
    }
    // 3) テキスト救済
    for (const p of parts) {
      if (typeof p?.text === "string" && p.text.trim()) {
        return { text: p.text.trim() };
      }
    }
  } catch { /* noop */ }
  return {};
}

/* ---------------------------- hooks ------------------------------ */

/** 画像生成：テキスト＋（任意）参照画像 → ギャラリーに追加 */
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
      if (DEBUG()) console.log("[DRESSUP][gen] resp", resp);

      const out = await resolveOutputFromResponse(resp);
      if (out.dataUrl) {
        addUploadedImage(out.dataUrl);
        log("generate image extracted ✓");
      } else if (out.text) {
        console.warn("[DRESSUP][gen] text only:", out.text);
      } else {
        console.warn("[DRESSUP][gen] no image/text in response", resp);
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
        image1: canvasImage,             // 元画像（dataURL想定）
        image2: editReferenceImages?.[0],// 参照は任意（dataURL想定）
        mime1: "image/png",
        mime2: "image/png",
      });
      if (DEBUG()) console.log("[DRESSUP][edit] resp", resp);

      const out = await resolveOutputFromResponse(resp);
      if (out.dataUrl) {
        setCanvasImage(out.dataUrl);
        log("edit image extracted ✓");
      } else if (out.text) {
        console.warn("[DRESSUP][edit] text only:", out.text);
      } else {
        console.warn("[DRESSUP][edit] no image/text in response", resp);
      }
      return resp;
    },
  });

  return { edit: m.mutateAsync, isPending: m.isPending };
}

export default useImageGeneration;
