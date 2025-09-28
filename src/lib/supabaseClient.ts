// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

// Vite(ブラウザ)で置き換わる公開キー
const VITE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const VITE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Next系にしたときの保険（置き換わる場合のみ）
const NEXT_URL = (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
const NEXT_ANON = (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;

// 最終的に使う値（Vite優先 → Next公開 → SSR用は使わない）
const supabaseUrl = VITE_URL || NEXT_URL;
const supabaseAnonKey = VITE_ANON || NEXT_ANON;

if (!supabaseUrl || !supabaseAnonKey) {
  // 何が入っていないか分かるように詳細メッセージ
  throw new Error(
    `Supabase public env is missing.
     VITE_SUPABASE_URL=${String(VITE_URL)}
     VITE_SUPABASE_ANON_KEY=${VITE_ANON ? '[set]' : 'undefined'}
     NEXT_PUBLIC_SUPABASE_URL=${String(NEXT_URL)}
     NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_ANON ? '[set]' : 'undefined'}`
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
