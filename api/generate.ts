// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ✅ Gemini だけ使う（Images API / NANOBANANA は使わない）
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

// --- helpers ---
function b64FromDataUrl(input: string): { mime: string; data: string } {
  // data:[mime];base64,xxxx
  const m = input.match(/^data:(.+?);base64,(.+)$/);
  if (m) return { mime: m[1], data: m[2] };
  // 裸のbase64だけ来るケースにも対応（デフォルトPNG扱い）
  return { mime: 'image/png', data: input };
}

function findInlineImageFromCandidates(resp: any): { data: string; mimeType: string } | null {
  const cands = resp?.candidates ?? [];
  for (const c of cands) {
    const parts = c?.content?.parts ?? [];
    for (const p of parts) {
      const d = p?.inlineData;
      if (d?.data) {
        const mime = d.mimeType || 'image/png';
        return { data: d.data, mimeType: mime };
      }
    }
  }
  return null;
}

function firstText(resp: any): string | null {
  const cands = resp?.candidates ?? [];
  for (const c of cands) {
    const parts = c?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p?.text === 'string' && p.text.trim()) return p.text.trim();
    }
  }
  return null;
}

// 画像生成（Gemini固定）
async function callGeminiGenerateImage({
  apiKey,
  model,
  prompt,
  image1,
  image2,
  temperature = 0.6,
  seed = undefined as number | undefined,
  forceImageOnly = false,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  image1: string;
  image2?: string | null;
  temperature?: number;
  seed?: number;
  forceImageOnly?: boolean;
}) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    // 画像だけ返すように強制
    generationConfig: {
      responseMimeType: 'image/png',
      temperature: forceImageOnly ? 0 : temperature ?? 0.6,
      ...(seed !== undefined ? { seed } : {}),
    },
    ...(forceImageOnly
      ? {
          systemInstruction: {
            role: 'system',
            parts: [
              {
                text:
                  'Return an edited image as inline image only. Do not include any text. Output must be PNG.',
              },
            ],
          },
        }
      : undefined),
  });

  // 入力 parts: image1 → image2 → text(prompt)
  const p1 = b64FromDataUrl(image1);
  const parts: any[] = [
    { inlineData: { mimeType: p1.mime, data: p1.data } },
  ];
  if (image2) {
    const p2 = b64FromDataUrl(image2);
    parts.push({ inlineData: { mimeType: p2.mime, data: p2.data } });
  }
  parts.push({ text: prompt });

  // 単発生成
  const resp = await genModel.generateContent({
    contents: [{ role: 'user', parts }],
  });
  return resp.response;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Server misconfigured (Supabase)' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server misconfigured (GEMINI_API_KEY missing)' });
    }

    // --- 認証 & 残回数チェック ---
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: uinfo, error: uerr } = await supabase.auth.getUser(token);
    if (uerr || !uinfo?.user) return res.status(401).json({ error: 'Invalid token' });
    const userId = uinfo.user.id;

    const { data: row, error: selErr } = await supabase
      .from('users')
      .select('credits_total, credits_used')
      .eq('id', userId) // ← あなたのusersテーブル主キーがid(uuid)である前提
      .single();

    if (selErr || !row) return res.status(500).json({ error: 'User row not found' });
    const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
    if (remaining <= 0) return res.status(402).json({ error: 'No credits' });

    // 先に消費（重複押下対策）
    const { error: rpcErr } = await supabase.rpc('consume_credit', { p_user_id: userId });
    if (rpcErr) return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });

    // --- リクエスト取り出し ---
    const { prompt, image1, image2 = null, temperature = 0.6, seed = undefined } = req.body || {};
    if (!prompt || !image1) return res.status(400).json({ error: 'Missing prompt or image1' });

    // --- 1回目（通常） ---
    let response = await callGeminiGenerateImage({
      apiKey: GEMINI_API_KEY,
      model: GEMINI_IMAGE_MODEL,
      prompt,
      image1,
      image2,
      temperature,
      seed,
    });

    let found = findInlineImageFromCandidates(response);
    if (!found) {
      // --- 2回目（画像のみ強制で再試行） ---
      response = await callGeminiGenerateImage({
        apiKey: GEMINI_API_KEY,
        model: GEMINI_IMAGE_MODEL,
        prompt,
        image1,
        image2,
        temperature: 0,
        seed,
        forceImageOnly: true,
      });
      found = findInlineImageFromCandidates(response);
    }

    if (found) {
      return res.status(200).json({
        image: { data: found.data, mimeType: found.mimeType || 'image/png' },
      });
    }

    // テキストしか返らない場合のログ用
    const txt = firstText(response) || 'No image in response';
    return res.status(502).json({ error: 'No image in response', text: txt });
  } catch (e: any) {
    // ここに Images API の 404/Not Found が来ていた
    return res.status(500).json({ error: 'Images API error', detail: e?.message || String(e) });
  }
}
