// src/hooks/useImageGeneration.ts
// Edit専用フック。Generate関連のコードはすべて削除しています。

import { useMutation } from '@tanstack/react-query';

/** API へ投げる編集リクエストの型 */
export type EditPayload = {
  /** 変更指示（必須） */
  prompt: string;
  /** Base 画像（必須, dataURL など base64 文字列） */
  image1: string;
  /** 参照画像（任意, dataURL など base64 文字列） */
  image2?: string | null;
  /** 以下は必要に応じて（API側で未使用なら送らなくてOK） */
  model?: string;
  temperature?: number;
  seed?: number | null;
};

const EDIT_ENDPOINT = '/api/edit';

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // 成功
  if (res.ok) {
    // 画像生成系 API では text-only の応答を返すこともあるため JSON/テキストを両方許容
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return (await res.json()) as T;
    const text = await res.text();
    // テキストしかなければ最低限の形で返す（呼び出し側で検出しやすい）
    return { textOnly: text } as unknown as T;
  }

  // 失敗（詳細メッセージ整形）
  let detail: any = null;
  try {
    detail = await res.json();
  } catch {
    try {
      detail = await res.text();
    } catch {
      /* noop */
    }
  }

  // ステータス別のわかりやすいメッセージ
  if (res.status === 400) {
    throw new Error(
      typeof detail === 'object' && detail?.error
        ? JSON.stringify(detail)
        : 'Bad Request: prompt と image1 は必須です'
    );
  }
  if (res.status === 413) {
    throw new Error('Request Entity Too Large: 画像が大きすぎます。アップロード画像を縮小してください。');
  }

  throw new Error(
    typeof detail === 'object' && detail?.error
      ? JSON.stringify(detail)
      : `Request failed: ${res.status} ${res.statusText}`
  );
}

/**
 * 画像編集フック
 * - /api/edit に対して JSON を POST
 * - レスポンスはそのまま返す（呼び出し側で inlineData の抽出を実施）
 */
export function useImageEditing() {
  return useMutation({
    mutationFn: async (payload: EditPayload) => {
      // 最低限のクライアントバリデーション
      if (!payload?.prompt?.trim()) throw new Error('prompt は必須です');
      if (!payload?.image1) throw new Error('image1（Base画像）は必須です');

      // 余計な undefined を落として軽量化
      const cleanPayload: Record<string, unknown> = {};
      cleanPayload.prompt = payload.prompt.trim();
      cleanPayload.image1 = payload.image1;
      if (payload.image2) cleanPayload.image2 = payload.image2;
      if (payload.model) cleanPayload.model = payload.model;
      if (typeof payload.temperature === 'number') cleanPayload.temperature = payload.temperature;
      if (payload.seed !== undefined) cleanPayload.seed = payload.seed;

      const resp = await postJSON<any>(EDIT_ENDPOINT, cleanPayload);
      return resp;
    },
  });
}

/* ===== メモ =====
  - これ以外の export（useImageGeneration など）は削除してください。
  - 呼び出し側（PromptComposer.tsx）は edit({ prompt, image1, image2 }) のみを使用。
  - 413 エラーが出る場合は、アップロード前に resize して総サイズを抑える（既に UI 側で実施済み）。
*/
