// /api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// --- 実際の画像生成APIを呼ぶ場所 ---
// すぐに動作確認できるよう、ECHO_GENERATE=true の時は
// image1 をそのまま返すスモークテストにします。
// これを /api/generate.ts の callImageEditAPI に上書きしてください
async function callImageEditAPI({
  prompt,
  image1,
  image2 = null,
  temperature = 0.7,
  seed = null,
}: {
  prompt: string;
  image1: string;
  image2?: string | null;
  temperature?: number;
  seed?: number | null;
}): Promise<{ data: string; mimeType: string }> {
  // スモークモード：ECHO_GENERATE=true なら image1 をそのまま返す
  if (process.env.ECHO_GENERATE === 'true') {
    const [mimePart, dataPart] = image1.split(';base64,');
    const mimeType = mimePart.replace('data:', '') || 'image/png';
    return { data: dataPart || '', mimeType };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not set');

  // data URL を {mimeType, data} に分解
  const parseDataUrl = (d: string) => {
    const [mimePart, dataPart] = d.split(';base64,');
    const mimeType = mimePart.replace('data:', '');
    const data = dataPart;
    return { mimeType, data };
  };

  const imgA = parseDataUrl(image1);
  const imgB = image2 ? parseDataUrl(image2) : null;

  // Gemini 2.5 Flash Image エンドポイント例（generateContent）
  // ドキュメントの “inline_data” 形式を利用して画像＋テキストを送る
  const reqBody: any = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: imgA.mimeType, data: imgA.data } },
        ],
      },
    ],
    generationConfig: {
      temperature,
      ...(seed != null ? { seed } : {}),
    },
  };
  if (imgB) {
    reqBody.contents[0].parts.push({
      inline_data: { mime_type: imgB.mimeType, data: imgB.data },
    });
  }

  const resp = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-001:generateContent?key=' + API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    }
  );

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${t}`);
  }

  const json = await resp.json();

  // 画像出力の取り出し（モデルの返し方により “inline_data” が parts に入る）
  // 代表的なパターンを拾う実装
  const candidates = json.candidates || [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      // 画像が inline_data で返る場合
      if (p.inline_data?.data) {
        const mimeType = p.inline_data.mime_type || 'image/png';
        const data = p.inline_data.data; // base64 without dataURL prefix
        return { data, mimeType };
      }
      // テキストしか返ってこない場合（失敗扱いにしておく）
    }
  }

  throw new Error('No image was returned from Gemini.');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (必要なら微調整)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // --- 1) Bearer でユーザー特定 ---
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: me, error: meErr } = await admin.auth.getUser(token);
    if (meErr || !me?.user) return res.status(401).json({ error: 'Invalid token' });

    const userId = me.user.id;
    const userEmail = me.user.email || null;

    // --- 2) users を upsert（id でも uuid でも動くよう両方トライ） ---
    const baseUser = {
      email: userEmail,
      plan: 'free',
      credits_total: 10,
      credits_used: 0,
    };

    // onConflict は存在するユニークキー/PK を指定する必要がある
    // 先に id で upsert を試し、失敗したら uuid で再試行（列が無い/キーが違う環境を吸収）
    let upsertOk = false;
    {
      const { error } = await admin
        .from('users')
        .upsert([{ id: userId, ...baseUser }], { onConflict: 'id' })
        .select('id');
      if (!error) upsertOk = true;
    }
    if (!upsertOk) {
      await admin
        .from('users')
        .upsert([{ uuid: userId, ...baseUser }], { onConflict: 'uuid' })
        .select('uuid');
    }

    // --- 3) 残クレジット確認（id → ダメなら uuid） ---
    // 列の有無で SELECT が失敗する場合があるので、順にフォールバック
    let creditsRow: { credits_total: number | null; credits_used: number | null } | null = null;

    {
      const q = await admin.from('users').select('credits_total, credits_used').eq('id', userId).limit(1).maybeSingle();
      if (!q.error && q.data) {
        creditsRow = q.data;
      }
    }
    if (!creditsRow) {
      const q = await admin.from('users').select('credits_total, credits_used').eq('uuid', userId).limit(1).maybeSingle();
      if (!q.error && q.data) {
        creditsRow = q.data;
      }
    }
    if (!creditsRow) {
      return res.status(500).json({ error: "DB error(select users)", detail: "Neither 'id' nor 'uuid' matched" });
    }

    const creditsTotal = creditsRow.credits_total ?? 0;
    const creditsUsed = creditsRow.credits_used ?? 0;
    const remaining = creditsTotal - creditsUsed;
    if (remaining <= 0) return res.status(402).json({ error: 'No credits' });

    // --- 4) 入力チェック ---
    const { prompt, image1, image2 = null, temperature = 0.7, seed = null } = (req.body || {}) as {
      prompt: string;
      image1: string;
      image2?: string | null;
      temperature?: number;
      seed?: number | null;
    };

    if (!prompt || !image1) return res.status(400).json({ error: 'Missing prompt or image1' });

    // --- 5) 先に消費（DB整合性を優先）。RPCは p_user_id uuid を受ける想定 ---
    const { error: rpcErr } = await admin.rpc('consume_credit', { p_user_id: userId });
    if (rpcErr) {
      // 競合や一時失敗は 409 で返し、フロントで再実行を促す
      return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });
    }

    // --- 6) 画像生成 ---
    const result = await callImageEditAPI({ prompt, image1, image2, temperature, seed });

    // --- 7) 成功レスポンス（フロントが必ず finally へ到達できるよう JSON 固定） ---
    return res.status(200).json({ image: { data: result.data, mimeType: result.mimeType } });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message ?? e) });
  }
}
