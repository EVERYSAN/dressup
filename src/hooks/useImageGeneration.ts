import { useMutation } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';

type GenerateArgs = {
  prompt: string;
  referenceImages?: string[]; // dataURL (最大2推奨)
};

type EditArgs = {
  prompt: string;
  image1: string;             // ★ BASE（必須）
  image2?: string | null;     // 参照（任意）
};

async function postJSON<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(err || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function useImageGeneration() {
  const { temperature, seed } = useAppStore.getState();

  return useMutation({
    mutationFn: async ({ prompt, referenceImages }: GenerateArgs) => {
      const body = {
        prompt,
        referenceImages,
        temperature,
        seed,
      };
      // /api/generate はテキスト or 画像+テキストの生成
      return postJSON<any>('/api/generate', body);
    },
  });
}

export function useImageEditing() {
  const { temperature, seed } = useAppStore.getState();

  return useMutation({
    // ★ image1 を必ず受け取る
    mutationFn: async ({ prompt, image1, image2 }: EditArgs) => {
      const body = {
        prompt,
        image1,           // ← BASE を明示
        image2: image2 || undefined,
        temperature,
        seed,
      };
      // /api/edit は image1 をベースに編集し、image2 を参照（任意）
      return postJSON<any>('/api/edit', body);
    },
  });
}
