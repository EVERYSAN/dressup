// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * 必要な環境変数（Vercel）
 * - GEMINI_API_KEY                  : AI Studio の API キー（必須）
 * - GEMINI_IMAGE_MODEL  (任意)      : 例) gemini-2.5-flash-image-preview（未設定ならこれ）
 * - SUPABASE_URL                    : Supabase プロジェクト URL（必須）
 * - SUPABASE_SERVICE_ROLE_KEY       : Service Role Key（必須）※サーバー専用
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const RAW_MODEL = (process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview').trim();

// よくあるミスを吸収（preview 付け忘れ）
function normalizeModel(m: string) {
  if (m === 'gemini-2.5-flash-image') return 'gemini-2.5-flash-image-preview';
  return m;
}
const MODEL = normalizeModel(RAW_MODEL);
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// dataURL を base64 と mime に分解
function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!m) return { mime: 'image/png', base64: dataUrl };
  return { mime: m[1], base64: m[2] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS（必要あれば調整）
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server error', detail: 'Missing GEMINI_API_KEY' });
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Server error', detail: 'Missing Supabase credentials' });
    }

    // Authorization: Bearer <access_token>
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: userInfo, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userInfo?.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const userId = userInfo.user.id; // Supabase Auth の UUID

    // リクエスト
    const { prompt, image1, image2, temperature } = req.body || {};
    if (!prompt || !image1) {
      return res.status(400).json({ error: 'Bad Request', detail: 'prompt and image1 are required' });
    }
    const p1 = splitDataUrl(image1);
    const p2 = image2 ? splitDataUrl(image2) : null;

    // users 行がなければ初回作成（在庫初期値はお好みで）
    {
      const { data: row, error: selErr } = await supabase
        .from('users')
        .select('id, credits_total, credits_used')
        .eq('id', userId)            // ※列名はあなたのスキーマに合わせる（id で運用中）
        .single();

      if (selErr || !row) {
        const { error: upErr } = await supabase
          .from('users')
          .upsert(
            { id: userId, credits_total: 10, credits_used: 0 },
            { onConflict: 'id' }
          );
        if (upErr) {
          return res.status(500).json({ error: 'Upsert user failed', detail: upErr.message });
        }
      }
    }

    // 残回数チェック
    {
      const { data: row, error: selErr } = await supabase
        .from('users')
        .select('credits_total, credits_used')
        .eq('id', userId)
        .single();

      if (selErr || !row) {
        return res.status(500).json({ error: 'DB error(select users)', detail: selErr?.message || 'row not found' });
      }

      const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
      if (remaining <= 0) {
        return res.status(402).json({ error: 'No credits' });
      }
    }

    // 先に 1 クレジット消費（競合や多重クリック対策）
    {
      const { error: rpcErr } = await supabase.rpc('consume_credit', { p_user_id: userId });
      if (rpcErr) {
        // 競合や RLS エラーなど
        return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });
      }
    }

    // 画像を返すよう強めに誘導（REST は response_mime_type 指定不可のため）
    const systemText =
      'You are an image editing model. Always return the result as an IMAGE (inlineData). ' +
      'Do not include any textual explanation in the response parts.';

    const body = {
      systemInstruction: { role: 'system', parts: [{ text: systemText }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: p1.mime, data: p1.base64 } },
            ...(p2 ? [{ inline_data: { mime_type: p2.mime, data: p2.base64 } }] : []),
          ],
        },
      ],
      generationConfig: {
        temperature: typeof temperature === 'number' ? temperature : 0.7,
      },
    };

    // タイムアウト（Vercel 60s 対策）
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 55_000);

    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).catch((e) => {
      throw new Error(`Fetch failed: ${String(e)}`);
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return res.status(500).json({ error: 'Images API error', detail });
    }

    const json = await resp.json();
    const candidates = json?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];

    let imageBase64: string | null = null;
    let imageMime: string | null = null;
    const textOut: string[] = [];

    for (const part of parts) {
      if (part?.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        imageMime = part.inlineData.mimeType || 'image/png';
        break;
      }
      if (part?.inline_data?.data) {
        imageBase64 = part.inline_data.data;
        imageMime = part.inline_data.mime_type || 'image/png';
        break;
      }
      if (part?.text) textOut.push(part.text);
    }

    if (!imageBase64) {
      return res.status(500).json({ error: 'No image in response', text: textOut.join('\n') });
    }

    return res.status(200).json({ image: { data: imageBase64, mimeType: imageMime } });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
