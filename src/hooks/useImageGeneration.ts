// src/hooks/useImageGeneration.ts
import { useMutation } from "@tanstack/react-query";
import { useAppStore } from "../store/useAppStore";

/** デバッグON: localStorage.setItem('DEBUG_DRESSUP','1') */
const DEBUG = () =>
  typeof window !== "undefined" &&
  localStorage.getItem("DEBUG_DRESSUP") === "1";
const log = (...a: any[]) => {
  if (DEBUG()) console.log("[DRESSUP][hooks]", ...a);
};

/** APIラッパ（fetch 成功/失敗とJSON化を共通化） */
async function postJSON<T>(
  url: string,
  body: unknown
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // APIエラーはそのまま見えるように
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** レスポンスから最初の画像(or テキスト)を抜く */
async function pickFirstImageOrText(resp: any): Promise<{ dataUrl?: string; text?: string }> {
  try {
    const parts = resp?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return {};
    // 画像(base64)
    for (const p of parts) {
      const d = p?.inlineData;
      if (d?.data) {
        const mime = d?.mimeType || "image/png";
        return { dataUrl: `data:${mime};base64,${d.data}` };
      }
    }
    // URL（必要なら取得して dataURL 化するが、まずはテキストフォールバック）
    for (const p of parts) {
      if (typeof p?.text === "string" && p.text.trim()) {
        return { text: p.text.trim() };
      }
    }
  } catch { /* noop */ }
  return {};
}

/* ======================== 画像 生成 ======================== */

type GenerateArgs = {
  prompt: string;
  referenceImages?: string[]; // dataURL配列(任意)
  model?: string;             // サーバ側で固定するので任意
};

export function useImageGeneration() {
  const { addUploadedImage } = useAppStore();

  const m = useMutation<any, Error, GenerateArgs>({
    mutationKey: ["generate"],
    mutationFn: async ({ prompt, referenceImages, model }) => {
      const p = (prompt ?? "").trim();
      if (!p) throw new Error("prompt が空です");

      // デバッグ用に投げる形を見える化
      if (DEBUG()) {
        console.debug("[DRESSUP][generate] POST /api/generate body =", {
          prompt: p,
          referenceImagesCount: referenceImages?.length || 0,
          model: model || "(server default)",
        });
      }

      const resp = await postJSON<any>("/api/generate", {
        prompt: p,
        referenceImages, // ← フィールド名はサーバと厳密一致
        model,
      });

      const out = await pickFirstImageOrText(resp);
      if (out.dataUrl) {
        addUploadedImage(out.dataUrl);
        log("generate: image ✓");
      } else if (out.text) {
        console.warn("[DRESSUP][generate] text only:", out.text);
      } else {
        console.warn("[DRESSUP][generate] no image/text in response", resp);
      }
      return resp;
    },
  });

  return { generate: m.mutateAsync, isPending: m.isPending };
}

/* ======================== 画像 編集 ======================== */

export function useImageEditing() {
  const { canvasImage, editReferenceImages, setCanvasImage } = useAppStore();

  const m = useMutation<any, Error, string>({
    mutationKey: ["edit-image"],
    mutationFn: async (instruction) => {
      const prompt = (instruction ?? "").trim();
      if (!prompt) throw new Error("編集内容（prompt）が空です");
      if (!canvasImage) throw new Error("元画像（canvasImage）が未設定です");

      // base と同一の参照は送らない
      const ref = (editReferenceImages || []).find((img) => !!img && img !== canvasImage);

      if (DEBUG()) {
        console.debug("[DRESSUP][edit] POST /api/edit body =", {
          prompt,
          hasImage1: !!canvasImage,
          hasImage2: !!ref,
          model: "(server default)",
        });
      }

      const resp = await postJSON<any>("/api/edit", {
        prompt,
        image1: canvasImage,       // dataURL
        image2: ref || undefined,  // dataURL or undefined
      });

      const out = await pickFirstImageOrText(resp);
      if (out.dataUrl) {
        setCanvasImage(out.dataUrl);
        log("edit: image ✓");
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
