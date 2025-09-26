// src/hooks/useImageGeneration.ts
// ✅ 旧UIの引数（instruction/originalImage/referenceImages...）を受けても
//    内部で {prompt, image1, image2} に変換して /api/edit へ JSON で送信
// ✅ React Query の useMutation を利用

import { useMutation } from "@tanstack/react-query";
import geminiService, { fileToDataURL } from "@/services/geminiService";

export type UseImageGenerationParams = {
  // 旧UIから渡ってくる想定（両対応）
  instruction: string;
  originalImage: File | string;          // 1枚目（人物）
  referenceImages?: (File | string)[];   // 2枚目（服/アクセ）先頭を使用
  maskImage?: File | string;             // 今は未使用（将来：プロンプトに加味）
  temperature?: number;                  // 今は未使用（必要なら /api/generate 側で）
  seed?: number;                         // 今は未使用
  model?: string;                        // 省略可（既定は 'gemini-2.0-flash-exp'）
  mime1?: string;                        // 省略可 'image/png'
  mime2?: string;                        // 省略可 'image/png'
};

async function maybeDataURL(x?: File | string) {
  if (!x) return undefined;
  return typeof x === "string" ? x : await fileToDataURL(x);
}

export function useImageGeneration() {
  const mutation = useMutation({
    mutationKey: ["edit-image"],
    mutationFn: async (p: UseImageGenerationParams) => {
      // 旧 → 新 の正規化（ここで JSON 送信形に揃える）
      const prompt = p.instruction?.trim() || "";
      const image1 = await maybeDataURL(p.originalImage);
      const image2 =
        (p.referenceImages && p.referenceImages.length
          ? await maybeDataURL(p.referenceImages[0])
          : undefined) || undefined;

      if (!prompt || !image1) {
        throw new Error("instruction / originalImage が不足しています");
      }

      // サービスへ委譲（内部で /api/edit に JSON POST）
      const res = await geminiService.editImage({
        prompt,
        image1,
        image2,
        mime1: p.mime1 || "image/png",
        mime2: p.mime2 || "image/png",
        model: p.model || "gemini-2.0-flash-exp",
        // 旧パラメータは必要に応じて活用（現状未使用）
        temperature: p.temperature,
        seed: p.seed,
      });

      return res;
    },
  });

  return {
    edit: mutation.mutateAsync, // 例：await edit(params)
    ...mutation,
  };
}

export default useImageGeneration;
