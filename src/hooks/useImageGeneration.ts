// src/hooks/useImageGeneration.ts
import { useMutation } from "@tanstack/react-query";
import geminiService, { fileToDataURL, MaybeFile } from "../services/geminiService";

export type UseImageGenerationParams = {
  instruction: string;
  originalImage: MaybeFile;
  referenceImages?: MaybeFile[];
  maskImage?: MaybeFile;
  temperature?: number;
  seed?: number;
  model?: string;
  mime1?: string;
  mime2?: string;
};

const maybeDataURL = async (x?: MaybeFile) => {
  if (!x) return undefined;
  return typeof x === "string" ? x : await fileToDataURL(x);
};

export function useImageGeneration() {
  return useMutation<any, Error, UseImageGenerationParams>({
    mutationKey: ["edit-image"],
    mutationFn: async (p) => {
      const prompt = (p.instruction || "").trim();
      const image1 = await maybeDataURL(p.originalImage);
      const image2 = p.referenceImages?.length ? await maybeDataURL(p.referenceImages[0]) : undefined;

      if (!prompt || !image1) {
        throw new Error("instruction / originalImage が不足しています");
      }

      // サーバー経由で安全に送信（JSON, prompt/image1 固定）
      return geminiService.editImage({
        prompt,
        image1,
        image2,
        mime1: p.mime1 || "image/png",
        mime2: p.mime2 || "image/png",
        model: p.model || "gemini-2.0-flash-exp",
        temperature: p.temperature,
        seed: p.seed,
      });
    },
  });
}

export default useImageGeneration;
export function useImageEditing() {
  return useImageGeneration();
}
