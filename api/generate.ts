// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ---- 画像生成（ダミー：実処理に差し替えてOK）----
async function callImageEditAPI({
  prompt, image1, image2, temperature, seed,
}: { prompt: string; image1: string; image2?: string | null; temperature?: number; seed?: number | null; }) {
  const dummyBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  return { data: dummyBase64, mimeType: 'image/png' };
}

// ---- ユーティリティ ----
const json = (res: VercelResponse, status: number, body: any) => res.status(status).json(body);
const isMissingColErr = (err?: { message?: string | null }) =>
  !!err?.message?.toLowerCase?.().includes("column") && !!err?.message?.toLowerCase?.().includes("not find");

// usersテーブルの主キー列名を推定（uuid or id）。ついでに行も取得して返す。
async function getUserRowWithKey(
  admin: ReturnType<typeof createClient>,
  supaUid: string
): Promise<{ key: 'uuid' | 'id'; row: any | null; error: any | null }> {
  // 1) uuid でトライ
  let q1 = await admin.from('users').select('uuid, email, plan, credits_total, credits_used').eq('uuid', supaUid).maybeSingle();
  if (q1.error && isMissingColErr(q1.error)) {
    // 2) id で取り直し
    let q2 = await admin.from('users').select('id, email, plan, credits_total, credits_used').eq('id', supaUid).maybeSingle();
    if (q2.error) return { key: 'id', row: null, error: q2.error };
    return { key: 'id', row: q2.data ?? null, error: null };
  }
  if (q1.error) return { key: 'uuid', row: null, error: q1.error };
  return { key: 'uuid', row: q1.data ?? null, error: null };
}

// users 行を upsert（uuid 優先、ダメなら id）
async function upsertUserRow(
  admin: ReturnType<typeof createClient>,
  key: 'uuid' | 'id',
  supaUid: string,
  email: string | null
): Promise<{ ok: boolean; error: any | null }> {
  // まずは判定済みの key で insert/upsert
  let payload: any = {
    [key]: supaUid,
    email,
    plan: 'free',
    credits_total: 10,
    credits_used: 0,
    created_at: new Date().toISOString(),
  };
  let up = await admin.from('users').upsert(payload).select('*').maybeSingle();
  if (!up.error) return { ok: true, error: null };

  // もし列が無いエラーならキーを切り替えて再トライ（uuid→id or id→uuid）
  if (isMissingColErr(up.error)) {
    const altKey: 'uuid' | 'id' = key === 'uuid' ? 'id' : 'uuid';
    payload = {
      [altKey]: supaUid,
      email,
      plan: 'free',
      credits_total: 10,
      credits_used: 0,
      created_at: new Date().toISOString(),
    };
    const up2 = await admin.from('users').upsert(payload).select('*').maybeSingle();
    if (!up2.error) return { ok: true, error: null };
    return { ok: false, error: up2.error };
  }

  return { ok: false, error: up.error };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS（必要なら調整）
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });

    // 1) 認証（Bearer 必須）
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return json(res, 401, { error: 'Missing bearer token' });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: userInfo, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userInfo?.user) return json(res, 401, { error: 'Invalid token' });

    const supaUid = userInfo.user.id;
    const email = userInfo.user.email ?? null;

    // 2) users 行取得（uuid→id 自動判別）
    let { key, row, error } = await getUserRowWithKey(admin, supaUid);
    if (error && !String(error?.message || '').includes('PGRST116')) {
      // PGRST116 は「行が見つからない」なので無視。それ以外のDBエラーは返す
      return json(res, 500, { error: 'DB error(select users)', detail: error.message || String(error) });
    }

    // 3) 無ければ自動作成（free:10）
    if (!row) {
      const up = await upsertUserRow(admin, key, supaUid, email);
      if (!up.ok) {
        return json(res, 500, { error: 'Upsert user failed', detail: up.error?.message || String(up.error) });
      }
      // 作成後に再取得（キーは変わる可能性があるので再推定）
      const second = await getUserRowWithKey(admin, supaUid);
      if (second.error || !second.row) {
        return json(res, 500, { error: 'User row not found after upsert', detail: second.error?.message || String(second.error) });
      }
      key = second.key;
      row = second.row;
    }

    // 4) 残回数チェック
    const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
    if (remaining <= 0) return json(res, 402, { error: 'No credits' });

    // 5) 先に消費（競合に強い）
    const { error: rpcErr } = await admin.rpc('consume_credit', { p_user_id: supaUid });
    if (rpcErr) return json(res, 409, { error: 'Consume failed', detail: rpcErr.message });

    // 6) 入力チェック
    const { prompt, image1, image2 = null, temperature = 0.7, seed = null } = (req.body as any) || {};
    if (!prompt || !image1) return json(res, 400, { error: 'Missing prompt or image1' });

    // 7) 画像生成（あなたの実装に差し替えOK）
    const result = await callImageEditAPI({ prompt, image1, image2, temperature, seed });

    // 8) 常に JSON 返却
    return json(res, 200, { image: { data: result.data, mimeType: result.mimeType } });
  } catch (e: any) {
    return json(res, 500, { error: 'Server error', detail: String(e?.message || e) });
  }
}
