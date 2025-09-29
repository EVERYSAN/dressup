// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const MODEL = 'gemini-2.5-flash-image-preview'; // 画像を返す版（Nano Banana）

function stripDataUrl(v?: string | null) {
  if (!v) return null;
  const i = v.indexOf('base64,');
  return i >= 0 ? v.slice(i + 'base64,'.length) : v;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // 認証＆残回数チェック（あなたの既存ロジックのまま）
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: uinfo } = await supabase.auth.getUser(token);
    const userId = uinfo?.user?.id;
    if (!userId) return res.status(401).json({ error: 'Invalid token' });

    // 在庫チェック（省略）→ OK なら先に consume_credit を呼ぶ
    const { error: rpcErr } = await supabase.rpc('consume_credit', { p_user_id: userId });
    if (rpcErr) return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });

    // 入力
    const { prompt, image1, image2 = null, temperature = 0.7 } = req.body ?? {};
    const base64_1 = stripDataUrl(image1);
    const base64_2 = stripDataUrl(image2);
    if (!prompt || !base64_1) return res.status(400).json({ error: 'Missing prompt or image1' });

    // Gemini API（AI Studio）へ
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{
        parts: [
          { text: String(prompt) },
          { inline_data: { mime_type: 'image/webp', data: base64_1 } },
          ...(base64_2 ? [{ inline_data: { mime_type: 'image/webp', data: base64_2 } }] : []),
        ],
      }],
      generationConfig: {
        temperature, // 任意
      },
      safetySettings: [], // 必要に応じて
    };

    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => null);

    if (!r.ok) {
      // サーバ側で内容を握りつぶさず返す
      return res.status(500).json({ error: 'Images API error', detail: typeof json === 'string' ? json : JSON.stringify(json) });
    }

    const parts = json?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
    const data = imgPart?.inlineData?.data || imgPart?.inline_data?.data;
    const mime = imgPart?.inlineData?.mimeType || imgPart?.inline_data?.mime_type || 'image/png';

    if (!data) {
      // テキストやブロック理由を可視化
      const txt = parts.filter((p: any) => p?.text).map((p: any) => p.text).join('\n').slice(0, 500);
      const fb = json?.promptFeedback || json?.safetyRatings;
      return res.status(500).json({ error: 'No image in response', text: txt, feedback: fb });
    }

    return res.status(200).json({ image: { data, mimeType: mime } });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
