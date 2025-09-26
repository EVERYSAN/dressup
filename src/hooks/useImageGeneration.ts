// src/hooks/useImageGeneration.ts
import { useMutation } from "@tanstack/react-query";
import geminiService, { fileToDataURL, MaybeFile } from "../services/geminiService";
import { useAppStore } from "../store/useAppStore";

// ---------- 生成用フック（PromptComposer から generate(...) を呼ぶ） ----------
export function useImageGeneration() {
  const mutation = useMutation({
    mutationKey: ["generate"],
    mutationFn: async (p: {
      prompt: string;
      referenceImages?: (MaybeFile | string)[];
      model?: string;
    }) => {
      // File を dataURL に（サービス側も対応済みだが二重変換でも安全）
      const refs = p.referenceImages
        ? await Promise.all(
            p.referenceImages.map(async (x) =>
              typeof x === "string" ? x : await fileToDataURL(x as File)
            )
          )
        : undefined;

      return geminiService.generate({
        prompt: p.prompt,
        referenceImages: refs,
        model: p.model,
      });
    },
  });

  return {
    generate: mutation.mutateAsync,
    ...mutation,
  };
}

// ---------- 編集用フック（PromptComposer から edit(prompt) を呼ぶ） ----------
export function useImageEditing() {
  const { canvasImage, editReferenceImages } = useAppStore();

  const mutation = useMutation({
    mutationKey: ["edit-image"],
    mutationFn: async (instruction: string) => {
      if (!instruction?.trim()) throw new Error("編集内容（prompt）が空です");
      if (!canvasImage) throw new Error("編集する元画像（canvasImage）が未設定です");

      // 2枚目（参照）は任意：先頭を採用
      const image2 = editReferenceImages?.[0];

      return geminiService.editImage({
        prompt: instruction.trim(),
        image1: canvasImage,     // 元画像（dataURL想定）
        image2,                  // 任意（dataURL想定）
        mime1: "image/png",
        mime2: "image/png",
      });
    },
  });

  return {
    edit: mutation.mutateAsync,
    ...mutation,
  };
}

export default useImageGeneration;
