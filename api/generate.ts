// /api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// --- 実際の画像生成APIを呼ぶ場所 ---
// すぐに動作確認できるよう、ECHO_GENERATE=true の時は
// image1 をそのまま返すスモークテストにします。
async function callImageEditAPI(params: {
  prompt: string;
  image1: string;             // dataURL (base64)
  image2?: string | null;     // dataURL (base64)
  temperature?: number;
  seed?: number | null;
}): Promise<{ data: string; mimeType: string }> {
  // 1) スモークテスト：入力画像をそのまま返す
  if (process.env.ECHO_GENERATE === 'true') {
    // image1 は "data:<mime>;base64,<data>" 形式なので、取り出して返す
    const [mimePart, dataPart] = params.image1.split(';base64,');
    const mimeType = mimePart.replace('data:', '') || 'image/png';
    const data = dataPart || '';
    return { data, mimeType };
  }

  // 2) ここに Gemini / ほかの画像編集API を実装
  // 例:
  // const out = await geminiEdit({ prompt: params.prompt, image1: params.image1, image2: params.image2, ... });
  // return { data: out.base64, mimeType: out.mimeType || 'image/png' };

  // ひとまず安全側：1x1透明はもう返さない（真っ白問題の回避）
  // 入力が無ければエラーにする
  throw new Error('Image edit backend is not configured. Set ECHO_GENERATE=true for smoke test.');
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
