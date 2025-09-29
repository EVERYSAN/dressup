// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GOOGLE_API_KEY = process.env.GEMINI_API_KEY!;             // ← Google AI Studio の API キー
const ECHO = process.env.ECHO_GENERATE === 'true';

// ---------- Google AI Images API (Imagen 3) 呼び出し ----------
async function callImageEditAPI({
  prompt,
  image1,
  image2,           // マスクや参照を使う場合に利用（無ければ null）
}: {
  prompt: string;
  image1: string;   // dataURL (base64)
  image2?: string | null;
}) {
  if (ECHO) {
    // スモークテスト: ベース画像をそのまま返す
    const b64 = image1.split(',')[1] || image1;
    const mime = image1.split(';')[0].replace('data:', '') || 'image/png';
    return { data: (image1.includes(',') ? b64 : image1), mimeType: mime };
  }

  // dataURL -> {mime, b64} に分解
  const parse = (d: string) => {
    if (!d) return null;
    const [m, b64] = d.split(';base64,');
    return { mime: m.replace('data:', ''), b64 };
  };
  const base = parse(image1);
  if (!base) throw new Error('invalid base image');

  // （オプション）mask or ref。ここでは mask 方式の例にしています
  const mask = image2 ? parse(image2) : null;

  // Images API: v1beta / images:edit もしくは images:generate
  // - edit: 入力画像＋mask＋指示で編集結果を返す
  // - generate: テキストから生成（参照を使わない場合）
  // ここでは edit を使います
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/images:edit?key=${GOOGLE_API_KEY}`;

  const body: any = {
    // editors: beta で仕様変化があるため、可能なら実機で /v1beta/models を List して整合確認を
    // "image" や "mask" の指定は bytesBase64Encoded を想定
    // 下記の payload は現在の GA 対応に合わせた一般形です
    // （将来の仕様変更に備え、エラー時はレスポンス本文をログ出力してください）
    edit: {
      prompt, // 指示
      image: { imageBytes: base.b64 },                // 入力画像
      ...(mask ? { mask: { imageBytes: mask.b64 } } : {}),
      // 生成の詳細パラメータはお好みで（サイズ/手数/安全設定 など）
      // params: { ... }
    },
  };

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Images API error ${resp.status}: ${t}`);
  }

  const json = await resp.json();
  // 返却形は beta で変化がありますが、通常は base64 の画像が 1 枚以上返ります
  // 代表的には { images: [{ content: { imageBytes: "..." , mimeType } }] } のような形
  const first =
    json?.images?.[0]?.content?.imageBytes ||
    json?.images?.[0]?.b64 ||
    json?.image?.b64 ||
    null;

  const mime =
    json?.images?.[0]?.content?.mimeType ||
    json?.images?.[0]?.mimeType ||
    'image/png';

  if (!first) throw new Error('Images API returned no image');

  return { data: first, mimeType: mime };
}

// ----------------- ここから既存のハンドラ（認証 / 在庫消費 / 返却） -----------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    return res.status(204).end();
  }
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // Authorization からユーザー特定
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: userInfo, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userInfo?.user) return res.status(401).json({ error: 'Invalid token' });

    const userId = userInfo.user.id;

    // users テーブルの在庫チェック（id カラムで管理している想定）
    const { data: row, error: selErr } = await supabaseAdmin
      .from('users')
      .select('credits_total, credits_used')
      .eq('id', userId)             // ← ここは "uuid" でなく "id"（実テーブルに合わせる）
      .single();
    if (selErr || !row) return res.status(500).json({ error: 'User row not found' });

    const remaining = (row.credits_total ?? 0) - (row.credits_used ?? 0);
    if (remaining <= 0) return res.status(402).json({ error: 'No credits' });

    // まずクレジットを消費（重複実行に強い）
    const { error: rpcErr } = await supabaseAdmin.rpc('consume_credit', { p_user_id: userId });
    if (rpcErr) return res.status(409).json({ error: 'Consume failed', detail: rpcErr.message });

    const { prompt, image1, image2 = null } = req.body || {};
    if (!prompt || !image1) return res.status(400).json({ error: 'Missing prompt or image1' });

    // 画像生成（編集）
    const result = await callImageEditAPI({ prompt, image1, image2 });

    // JSON で返却（フロント側の取り込みは既に実装済み）
    return res.status(200).json({ image: { data: result.data, mimeType: result.mimeType } });
  } catch (e: any) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
