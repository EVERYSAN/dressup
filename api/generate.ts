// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** スモークテスト: true のときは image1 をそのまま返す */
const ECHO_GENERATE = String(process.env.ECHO_GENERATE || '').toLowerCase() === 'true';

/** Gemini 画像生成に使うキー/モデル/エンドポイント */
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GENAI_API_KEY || '';
/** 画像出力対応のモデル（既定は 2.5 Flash Image） */
const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || 'models/gemini-2.5-flash-image';
/** v1beta generateContent エンドポイント */
const GEMINI_ENDPOINT =
  process.env.GEMINI_IMAGES_ENDPOINT ||
  'https://generativelanguage.googleapis.com/v1beta';

type GenerateBody = {
  prompt: string;
  image1: string;           // base64 data URL
  image2?: string | null;   // optional 2nd image (data URL)
  temperature?: number;
  seed?: number | null;
};

// Data URL -> { mime, base64 }
function splitDataUrl(dataUrl: string) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL');
  return { mime: m[1], base64: m[2] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS(必要なら)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 1) 認証
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: uinfo, error: uerr } = await supabase.auth.getUser(token);
    if (uerr || !uinfo?.user) return res.status(401).json({ error: 'Invalid token' });
    const uid = uinfo.user.id;

    // 2) クレジット残高確認
    const { data: row, error: selErr } = await supabase
      .from('users')
      .select('credits_total, credits_used')
      .eq('id', uid)          // ←テーブルが id(uuid) 主キーの前提
      .single();

    if (selErr || !row) return res.status(500).json({ error: 'DB error(select users)', detail: selErr?.message || 'row not found' });

    const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
    if (remaining <= 0) return res.status(402).json({ error: 'No credits' });

    const { prompt, image1, image2 = null, temperature = 0.7, seed = null } = (req.body || {}) as GenerateBody;
    if (!prompt || !image1) return res.status(400).json({ error: 'Missing prompt or image1' });

    // 3) 先に消費（多重実行に強い）
    const { error: rpcErr } = await supabase.rpc('consume_credit', { p_user_id: uid });
    if (rpcErr) return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });

    // 4) スモークテスト
    if (ECHO_GENERATE) {
      try {
        const { mime, base64 } = splitDataUrl(image1);
        return res.status(200).json({ image: { data: base64, mimeType: mime } });
      } catch (e: any) {
        return res.status(500).json({ error: 'Echo failed', detail: String(e?.message || e) });
      }
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server error', detail: 'Gemini API key is not configured.' });
    }

    // 5) Gemini へリクエスト（画像返答を強制）
    const parts: any[] = [{ text: prompt }];

    // base
    const b = splitDataUrl(image1);
    parts.push({ inlineData: { mimeType: b.mime, data: b.base64 } });
    // ref (任意)
    if (image2) {
      const r = splitDataUrl(image2);
      parts.push({ inlineData: { mimeType: r.mime, data: r.base64 } });
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'image/png',   // ←画像で返させる
        temperature,
        ...(seed != null ? { seed } : {}),
      },
      systemInstruction: {
        role: 'system',
        parts: [
          {
            text:
              'You are an image editor. Return an IMAGE only (inlineData) that reflects the instruction. ' +
              'Do NOT return any text or explanations. Preserve pose and lighting unless the instruction says otherwise.',
          },
        ],
      },
    };

    const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent?key=${encodeURIComponent(
      GEMINI_API_KEY
    )}`;

    const gRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!gRes.ok) {
      const txt = await gRes.text().catch(() => '');
      return res.status(500).json({ error: 'Images API error', detail: txt || gRes.statusText });
    }

    const payload = await gRes.json();

    // 6) 画像取り出し（1)ダイレクト返却形式 / 2)Gemini の inlineData）
    const partsOut = payload?.candidates?.[0]?.content?.parts || [];
    const inline = partsOut.find((p: any) => p?.inlineData?.data)?.inlineData;

    if (!inline?.data) {
      // モデルが誤ってテキストだけ返した場合のガード
      const fallbackText =
        (partsOut.find((p: any) => typeof p?.text === 'string')?.text as string | undefined) || payload?.text;
      return res.status(500).json({
        error: 'No image in response',
        text: fallbackText,
      });
    }

    return res.status(200).json({
      // フロントが後方互換で拾えるよう raw の candidates も返す
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: inline.data, mimeType: inline.mimeType || 'image/png' } }],
          },
        },
      ],
      image: { data: inline.data, mimeType: inline.mimeType || 'image/png' }, // 新形式
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
