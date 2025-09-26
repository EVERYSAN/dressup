// src/services/geminiService.ts
export type GenerateReq = {
  prompt: string;
  model?: string; // 省略可: 'gemini-1.5-flash'
};

export type EditReq = {
  prompt: string;
  image1: string; // dataURL か pure base64
  image2?: string;
  mime1?: string;
  mime2?: string;
  model?: string; // 省略可: 'gemini-2.0-flash-exp'
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
  try { data = JSON.parse(text); } catch { throw new Error(text || 'Invalid JSON'); }
  if (!r.ok) {
    const msg = data?.error?.message || data?.error || text || 'API error';
    throw new Error(msg);
  }
  return data as T;
}

export class GeminiService {
  async generate(req: GenerateReq) {
    const body = {
      model: req.model || 'gemini-1.5-flash',
      contents: [{ parts: [{ text: req.prompt }] }],
    };
    return jsonFetch('/api/generate', body);
  }

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
}

export const geminiService = new GeminiService();
