import type { VercelRequest } from '@vercel/node';
import { supabaseAdmin } from './supabase';

// Authorization: Bearer <access_token> をヘッダで受け取り、ユーザーを取得
export async function getUserFromRequest(req: VercelRequest) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!token) return null;

  // アクセストークンからユーザーを逆引き
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user; // { id, email, ... }
}
