// src/services/geminiService.ts
// ✅ 安全版：必ず /api/edit に JSON で送信
// ✅ 後方互換：旧形式 { instruction, originalImage, referenceImages, ... } でも動作
// ✅ File と dataURL（"data:image/png;base64,..."）の両方を受け付ける

export type NewEditReq = {
  // 新フォーマット（推奨）
  prompt?: string;
  image1?: string;             // dataURL or pure base64
  image2?: string;             // 任意（アクセ/服）
  mime1?: string;              // 省略時 'image/png'
  mime2?: string;              // 省略時 'image/png'
  model?: string;              // 省略時 'gemini-2.0-flash-exp'
};

export type LegacyEditReq = {
  // 旧フォーマット（GUI側の既存実装）
  instruction?: string;
  originalImage?: string;
  referenceImages?: string[];  // [0] を image2 として使用
  maskImage?: string;          // いまは未使用（必要なら prompt に織り込み推奨）
  temperature?: number;
  seed?: number;
};

// File を受けるケースも考慮
type MaybeFile = File | string;

export type EditAny = (NewEditReq & LegacyEditReq) & {
  image1?: MaybeFile;
  image2?: MaybeFile;
  originalImage?: MaybeFile;
  referenceImages?: MaybeFile[];
};

// ---------- ユーティリティ ----------
export const fileToDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const maybeToDataURL = async (x: MaybeFile | undefined) => {
  if (!x) return undefined;
  return typeof x === "string" ? x : await fileToDataURL(x);
};

async function jsonFetch<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    if (!res.ok) throw new Error(text || "API error");
    return text as unknown as T;
  }
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error ||
      (typeof data === "string" ? data : text) ||
      "API error";
    throw new Error(msg);
  }
  return data as T;
}

// ---------- 旧→新 フォーマット正規化 ----------
async function normalizeEdit(req: EditAny) {
  // 1) 画像（File を dataURL 化）
  const image1FromNew = await maybeToDataURL(req.image1);
  const image1FromLegacy = await maybeToDataURL(req.originalImage);

  let image2FromNew = await maybeToDataURL(req.image2);
  if (!image2FromNew && req.referenceImages?.length) {
    image2FromNew = await maybeToDataURL(req.referenceImages[0]);
  }

  // 2) テキスト（prompt 優先、なければ instruction）
  const prompt = (req.prompt ?? req.instruction ?? "").trim();

  // 3) MIME / Model 既定値
  const mime1 = req.mime1 || "image/png";
  const mime2 = req.mime2 || "image/png";
  const model = req.model || "gemini-2.0-flash-exp";

  // 4) できるだけ新フォーマットに寄せる
  const body = {
    prompt,
    image1: image1FromNew ?? image1FromLegacy,
    image2: image2FromNew,
    mime1,
    mime2,
    model,
  };

  return body;
}

// ---------- サービス本体 ----------
export class GeminiService {
  // 画像編集（1枚目↔2枚目）
  async edit(anyReq: EditAny) {
    const body = await normalizeEdit(anyReq);
    return jsonFetch("/api/edit", body);
  }

  // 後方互換エイリアス（旧コード対応）
  async editImage(anyReq: EditAny) {
    return this.edit(anyReq);
  }

  // テキストなど汎用
  async generate(req: { prompt: string; model?: string }) {
    const body = {
      model: req.model || "gemini-1.5-flash",
      contents: [{ parts: [{ text: req.prompt }] }],
    };
    return jsonFetch("/api/generate", body);
  }

  // 旧エイリアス
  async generateImage(req: { prompt: string; model?: string }) {
    return this.generate(req);
  }
}

export const geminiService = new GeminiService();
export default geminiService;
