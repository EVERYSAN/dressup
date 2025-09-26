// src/services/geminiService.ts
export type MaybeFile = File | string;

export const fileToDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const maybeToDataURL = async (x?: MaybeFile) => {
  if (!x) return undefined;
  return typeof x === "string" ? x : await fileToDataURL(x);
};

const stripDataUrl = (s?: string) => (s ?? "").replace(/^data:[^;]+;base64,/, "");

async function jsonFetch<T = any>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) throw new Error(json?.error?.message || json?.error || text);
    return json as T;
  } catch {
    if (!res.ok) throw new Error(text || "API error");
    return text as unknown as T;
  }
}

export class GeminiService {
  // テキスト＋（任意）参照画像での生成
  async generate(req: {
    prompt: string;
    referenceImages?: (MaybeFile | string)[];
    model?: string; // default gemini-1.5-flash
  }) {
    const parts: any[] = [{ text: req.prompt }];
    if (req.referenceImages?.length) {
      for (const img of req.referenceImages) {
        const durl = await maybeToDataURL(img as MaybeFile);
        if (durl) {
          parts.push({
            inlineData: { mimeType: "image/png", data: stripDataUrl(durl) },
          });
        }
      }
    }
    const body = {
      model: req.model || "gemini-1.5-flash",
      contents: [{ parts }],
    };
    return jsonFetch("/api/generate", body);
  }

  // 画像編集（1枚目＝元画像、2枚目＝置き換え/付け足し）
  async edit(req: {
    prompt: string;
    image1: MaybeFile | string; // 元画像（必須）
    image2?: MaybeFile | string; // 参照（任意）
    mime1?: string;
    mime2?: string;
    model?: string; // default gemini-2.0-flash-exp
  }) {
    const image1 = await maybeToDataURL(req.image1);
    const image2 = await maybeToDataURL(req.image2 as any);
    const body = {
      prompt: req.prompt,
      image1,
      image2,
      mime1: req.mime1 || "image/png",
      mime2: req.mime2 || "image/png",
      model: req.model || "gemini-2.0-flash-exp",
    };
    return jsonFetch("/api/edit", body);
  }

  // 旧名互換
  async editImage(req: Parameters<GeminiService["edit"]>[0]) {
    return this.edit(req);
  }
  async generateImage(req: Parameters<GeminiService["generate"]>[0]) {
    return this.generate(req);
  }
}

export const geminiService = new GeminiService();
export default geminiService;
