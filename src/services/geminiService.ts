// src/services/geminiService.ts

export type GenerateReq = {
  prompt: string;
  model?: string; // default: 'gemini-1.5-flash'
};

export type EditReq = {
  prompt: string;  // 例: "1枚目の服を2枚目の服に置き換えてください"
  image1: string;  // dataURL も可（"data:image/png;base64,..."）
  image2?: string; // 追加・差し替え用
  mime1?: string;  // default 'image/png'
  mime2?: string;  // default 'image/png'
  model?: string;  // default 'gemini-2.0-flash-exp'
};

async function jsonFetch<T>(url: string, body: any, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });
  const text = await r.text();

  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(text || 'Invalid JSON'); }

  if (!r.ok) {
    const msg = data?.error?.message || data?.error || text || 'API error';
    throw new Error(msg);
  }
  return data as T;
}

export class GeminiService {
  // 新API: テキストなど汎用
  async generate(req: GenerateReq) {
    const body = {
      model: req.model || 'gemini-1.5-flash',
      contents: [{ parts: [{ text: req.prompt }] }],
    };
    return jsonFetch('/api/generate', body);
  }

  // 新API: 画像編集（1枚目↔2枚目）
  async edit(req: EditReq) {
    const body = {
      prompt: req.prompt,
      image1: req.image1,
      image2: req.image2,
      mime1: req.mime1 || 'image/png',
      mime2: req.mime2 || 'image/png',
      model: req.model || 'gemini-2.0-flash-exp',
    };
    return jsonFetch('/api/edit', body);
  }

  // ✅ 後方互換エイリアス（既存コード対策）
  // 以前: editImage(...) を呼んでいた場合を吸収
  async editImage(req: EditReq) {
    return this.edit(req);
  }

  // 以前: generateImage(...) を呼んでいた場合を吸収
  async generateImage(req: GenerateReq) {
    return this.generate(req);
  }
}

// どちらの import 形でも使えるようにエクスポート
export const geminiService = new GeminiService();
export default geminiService;

// 補助: File→dataURL（必要なら使ってね）
export const fileToDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
