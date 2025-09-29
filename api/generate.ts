// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// 画像生成（ここを本実装に差し替えOK）
async function callImageEditAPI({
  prompt, image1, image2, temperature, seed,
}: { prompt: string; image1: string; image2?: string | null; temperature?: number; seed?: number | null; }) {
  const dummyBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  return { data: dummyBase64, mimeType: 'image/png' };
}

// 返却ヘルパ
const json = (res: VercelResponse, status: number, body: any) => res.status(status).json(body);

// ---- カラム存在チェック（information_schema.columns を利用）----
async function hasColumn(
  admin: ReturnType<typeof createClient>,
  table: string,
  column: string,
  schema = 'public'
): Promise<boolean> {
  const { data, error } = await admin
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_schema', schema)
    .eq('table_name', table)
    .eq('column_name', column);
  if (error) {
    // information_schema にアクセスできないケースは稀だが、安全に false 扱い
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// users 主キー候補（uuid / id）を判定
async function detectUserKey(admin: ReturnType<typeof createClient>): Promise<'uuid' | 'id'> {
  const hasUuid = await hasColumn(admin, 'users', 'uuid');
  if (hasUuid) return 'uuid';
  const hasId = await hasColumn(admin, 'users', 'id');
  if (hasId) return 'id';
  // どちらも無い → スキーマ不一致
  throw new Error("Neither 'uuid' nor 'id' column exists on public.users");
}

// 指定キーで users 1行取得
async function selectUserRow(
  admin: ReturnType<typeof createClient>,
  key: 'uuid' | 'id',
  supaUid: string
) {
  return admin
    .from('users')
    .select('email, plan, credits_total, credits_used')
    .eq(key, supaUid)
    .maybeSingle();
}

// 指定キーで upsert（free:10 付与）
async function upsertUserRow(
  admin: ReturnType<typeof createClient>,
  key: 'uuid' | 'id',
  supaUid: string,
  email: string | null
) {
  const payload: any = {
    [key]: supaUid,
    email,
    plan: 'free',
    credits_total: 10,
    credits_used: 0,
    created_at: new Date().toISOString(),
  };
  return admin.from('users').upsert(payload).select('*').maybeSingle();
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

    // 2) users のキーを自動判別（ここで uuid 不在なら id を選ぶので「column users.uuid does not exist」を回避）
    const key = await detectUserKey(admin);

    // 3) 行取得 or 自動作成
    let { data: row, error: selErr } = await selectUserRow(admin, key, supaUid);
    if (selErr) return json(res, 500, { error: 'DB error(select users)', detail: selErr.message || String(selErr) });

    if (!row) {
      const { error: upErr } = await upsertUserRow(admin, key, supaUid, email);
      if (upErr) return json(res, 500, { error: 'Upsert user failed', detail: upErr.message || String(upErr) });

      const r2 = await selectUserRow(admin, key, supaUid);
      if (r2.error || !r2.data) {
        return json(res, 500, { error: 'User row not found after upsert', detail: r2.error?.message || String(r2.error) });
      }
      row = r2.data;
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

    // 7) 画像生成
    const result = await callImageEditAPI({ prompt, image1, image2, temperature, seed });

    // 8) 常に JSON 返却（finally に到達しやすくする）
    return json(res, 200, { image: { data: result.data, mimeType: result.mimeType } });
  } catch (e: any) {
    return json(res, 500, { error: 'Server error', detail: String(e?.message || e) });
  }
}
