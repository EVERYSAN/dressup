// api/edit.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Busboy from 'busboy';

const stripDataUrl = (s?: string) => (s ?? '').replace(/^data:[^;]+;base64,/, '');

type Normalized =
  | { passthrough: true; model: string; payload: any }
  | {
      passthrough: false;
      model: string;
      prompt: string;
      image1Base64: string;
      image2Base64?: string;
      mime1: string;
      mime2: string;
    };

function fromJsonBody(raw: any): Normalized | null {
  if (!raw) return null;

  // すでにGemini形式（contents）ならそのまま
  if (raw.contents) {
    return { passthrough: true, model: raw.model || 'gemini-2.0-flash-exp', payload: raw };
  }

  // ゆらぎ吸収
  const prompt: string = raw.prompt ?? raw.instruction ?? raw.text ?? '';
  const image1Raw: string | undefined =
    raw.image1 ?? raw.base64Image1 ?? raw.img1 ?? raw.source ?? raw.image;
  const image2Raw: string | undefined =
    raw.image2 ?? raw.base64Image2 ?? raw.img2 ?? raw.target;
  const mime1: string = raw.mime1 || 'image/png';
  const mime2: string = raw.mime2 || 'image/png';
  const model: string = raw.model || 'gemini-2.0-flash-exp';

  if (!prompt || !image1Raw) return null;

  return {
    passthrough: false,
    model,
    prompt,
    image1Base64: stripDataUrl(String(image1Raw)),
    image2Base64: image2Raw ? stripDataUrl(String(image2Raw)) : undefined,
    mime1,
    mime2,
  };
}

// multipart/form-data をパース（GUIが FormData で送る場合）
async function parseMultipart(req: VercelRequest): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers as any });
    const fields: Record<string, any> = {};

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('file', (name, file, info) => {
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => chunks.push(d));
      file.on('end', () => {
        const buf = Buffer.concat(chunks);
        // 画像はBase64文字列で保持（mimeはinfo.mimeTypeで取れる）
        fields[name] = buf.toString('base64');
        const keyMime = `${name}_mime`;
        fields[keyMime] = info.mimeType || 'application/octet-stream';
      });
    });

    bb.on('error', reject);
    bb.on('finish', () => resolve(fields));
    req.pipe(bb);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APIキー未設定' });

  try {
    const ct = (req.headers['content-type'] || '').toLowerCase();

    let norm: Normalized | null = null;

    if (ct.startsWith('application/json')) {
      const raw = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      norm = fromJsonBody(raw);
      if (!norm) {
        return res.status(400).json({
          error: 'prompt と image1 は必須です',
          gotKeys: Object.keys(raw || {}),
          hint: 'JSON なら { prompt, image1, image2? } もしくは { model, contents } を送ってください',
        });
      }
    } else if (ct.startsWith('multipart/form-data')) {
      const form = await parseMultipart(req);
      // 既定フィールド名を優先的に拾う（GUI側のname属性に合わせる）
      const prompt =
        form.prompt ?? form.instruction ?? form.text ?? '';

      // 画像は "image1" / "image2" で受ける（なければ一般的な "file" / "file1" も試す）
      const image1Base64: string | undefined =
        form.image1 ?? form.base64Image1 ?? form.file ?? form.file1;
      const image2Base64: string | undefined =
        form.image2 ?? form.base64Image2 ?? form.file2;

      const mime1: string = form.image1_mime || form.mime1 || 'image/png';
      const mime2: string = form.image2_mime || form.mime2 || 'image/png';
      const model: string = form.model || 'gemini-2.0-flash-exp';

      if (!prompt || !image1Base64) {
        return res.status(400).json({
          error: 'prompt と image1 は必須です（multipart）',
          gotKeys: Object.keys(form || {}),
          hint: 'FormData なら name="prompt" と name="image1"（ファイル）で送ってください',
        });
      }

      norm = {
        passthrough: false,
        model,
        prompt: String(prompt),
        image1Base64: String(image1Base64),
        image2Base64: image2Base64 ? String(image2Base64) : undefined,
        mime1,
        mime2,
      };
    } else {
      // その他はテキスト→JSON 試行
      const text = await (async () => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          return Buffer.concat(chunks).toString('utf8');
        } catch { return ''; }
      })();
      let raw: any = {};
      try { raw = JSON.parse(text); } catch {}
      norm = fromJsonBody(raw);
      if (!norm) {
        return res.status(400).json({
          error: '未対応の Content-Type か、必須フィールド不足です',
          contentType: ct || '(none)',
          hint: 'application/json か multipart/form-data で送ってください',
        });
      }
    }

    // ここから Gemini へ転送
    if (norm.passthrough) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${norm.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(norm.payload),
      });
      const text = await r.text();
      return res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
    }

    const { prompt, image1Base64, image2Base64, mime1, mime2, model } = norm;

    const parts: any[] = [
      { text: prompt },
      { inlineData: { mimeType: mime1, data: stripDataUrl(image1Base64) } },
    ];
    if (image2Base64) {
      parts.push({ inlineData: { mimeType: mime2, data: stripDataUrl(image2Base64) } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });

    const text = await r.text();
    return res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e: any) {
    return res.status(500).json({ error: 'proxy error', detail: e?.message });
  }
}
