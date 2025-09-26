// src/services/geminiService.ts
export type MaybeFile = File | string;

export type EditAny = {
  // 新
  prompt?: string;
  image1?: MaybeFile;
  image2?: MaybeFile;
  mime1?: string;
  mime2?: string;
  model?: string;
  // 旧
  instruction?: string;
  originalImage?: MaybeFile;
  referenceImages?: MaybeFile[];
  maskImage?: MaybeFile;
  temperature?: number;
  seed?: number;
};

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

async function normalizeEdit(req: EditAny) {
  const image1New = await maybeToDataURL(req.image1);
  const image1Old = await maybeToDataURL(req.originalImage);
  let image2New = await maybeToDataURL(req.image2);
  if (!image2New && req.referenceImages?.length) {
    image2New = await maybeToDataURL(req.referenceImages[0]);
  }
  const prompt = (req.prompt ?? req.instruction ?? "").trim();
  return {
    prompt,
    image1: image1New ?? image1Old,
    image2: image2New,
    mime1: req.mime1 || "image/png",
    mime2: req.mime2 || "image/png",
    model: req.model || "gemini-2.0-flash-exp",
  };
}

export class GeminiService {
  async edit(req: EditAny) {
    const body = await normalizeEdit(req);
    return jsonFetch("/api/edit", body);
  }
  async editImage(req: EditAny) {
    return this.edit(req);
  }
  async generate(req: { prompt: string; model?: string }) {
    const body = {
      model: req.model || "gemini-1.5-flash",
      contents: [{ parts: [{ text: req.prompt }] }],
    };
    return jsonFetch("/api/generate", body);
  }
  async generateImage(req: { prompt: string; model?: string }) {
    return this.generate(req);
  }
}

export const geminiService = new GeminiService();
export default geminiService;
