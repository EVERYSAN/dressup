// src/services/geminiService.ts
export type MaybeFile = File | string;

const DEBUG = () =>
  (typeof window !== 'undefined' && (localStorage.getItem('DEBUG_DRESSUP') === '1'));

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
  if (DEBUG()) {
    console.groupCollapsed(`[DRESSUP][fetch] ${url}`);
    console.log('request body', body);
  }
  const t0 = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const dt = (performance.now() - t0).toFixed(1);
  if (DEBUG()) {
    console.log('status', res.status, res.statusText, `(${dt}ms)`);
    try { console.log('response json', JSON.parse(text)); }
    catch { console.log('response text', text.slice(0, 500)); }
    console.groupEnd();
  }
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
  // 生成（テキスト＋任意の参照画像）
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
          parts.push({ inlineData: { mimeType: "image/png", data: stripDataUrl(durl) } });
        }
      }
    }
    const body = {
      model: req.model || "gemini-1.5-flash",
      contents: [{ parts }],
    };
    return jsonFetch("/api/generate", body);
  }

  // 編集（image1=元、image2=参照）
  async edit(req: {
    prompt: string;
    image1: MaybeFile | string;
    image2?: MaybeFile | string;
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
  async editImage(req: Parameters<GeminiService["edit"]>[0]) { return this.edit(req); }
  async generateImage(req: Parameters<GeminiService["generate"]>[0]) { return this.generate(req); }
}

export const geminiService = new GeminiService();
export default geminiService;
