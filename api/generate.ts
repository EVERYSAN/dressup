// api/generate.ts
// 毎回の生成前に Supabase の RPC `consume_credit` を呼び出して残回数を減らす。
// 残りがない場合は 402 を返してフロントにアラートさせる。

import { createClient } from '@supabase/supabase-js';

// ====== 必須：環境変数 ======
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  （Service role key）
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Admin クライアント（service role）
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// CORS（必要ならドメイン合わせて調整）
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ユーザー取得（フロントから Authorization: Bearer <accessToken> を渡す）
async function getUserFromRequest(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders,
      });
    }

    // 1) ユーザーを特定（フロントは Authorization ヘッダに access_token を付ける）
    const user = await getUserFromRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    // 2) まずクレジット消費（残りがない場合は false が返る）
    const { data: ok, error: rpcError } = await admin.rpc('consume_credit', {
      p_user_id: userId, // 関数側の引数名と一致させる！
    });

    if (rpcError) {
      console.error('consume_credit RPC error:', rpcError);
      return new Response(
        JSON.stringify({ message: 'Credit check failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (ok !== true) {
      // クレジット残なし
      return new Response(
        JSON.stringify({ message: 'No credits left' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3) ここからが実際の生成処理
    //    例：Gemini / OpenAI / 自前の画像生成… など
    //    ここではダミー応答（本番は実処理を追加）
    const body = await req.json().catch(() => ({}));
    const prompt = body?.prompt ?? '';

    // TODO: 実際の生成処理に置き換え（例）
    // const result = await generateImage(prompt);

    // 4) 任意：usage_log に詳細ログを残したい場合
    try {
      await admin.from('usage_log').insert({
        user_id: userId,
        action: 'generate',
        meta: { prompt },
      });
    } catch (e) {
      // ログは失敗しても処理を止めない
      console.warn('usage_log insert warn:', e);
    }

    // 5) 成功レスポンス
    return new Response(
      JSON.stringify({
        ok: true,
        // result, // ← 生成結果を返すなら添える
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ message: 'Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
