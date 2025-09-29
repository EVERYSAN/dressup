// src/components/Header.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { openPortal, buy } from '../lib/billing';
import PricingDialog from './PricingDialog';

type PlanKey = 'light' | 'basic' | 'pro';

export const Header: React.FC = () => {
  const [openPricing, setOpenPricing] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadingRemaining, setLoadingRemaining] = useState(false);

  // --- auth の初期化 & 監視 ---
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setIsAuthed(!!data.session);
      if (data.session?.user) {
        void fetchRemaining(data.session.user.id);
      } else {
        setRemaining(null);
      }
    };
    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session);
      if (session?.user) {
        void fetchRemaining(session.user.id);
      } else {
        setRemaining(null);
      }
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // --- 残回数を users テーブルから取得 ---
  const fetchRemaining = async (uid: string) => {
    try {
      setLoadingRemaining(true);
      const { data, error } = await supabase
        .from('users')
        .select('credits_total, credits_used')
        .eq('uuid', uid) // ← Auth.user.id を users.uuid で紐付け
        .single();

      if (error) throw error;
      const left =
        (data?.credits_total ?? 0) - (data?.credits_used ?? 0);
      setRemaining(left);
    } catch (e) {
      console.error('[header] fetchRemaining error', e);
      setRemaining(null);
    } finally {
      setLoadingRemaining(false);
    }
  };

  // --- 料金表（モーダル） ---
  const handleOpenPricing = useCallback(() => setOpenPricing(true), []);
  const handleBuy = useCallback(async (plan: PlanKey) => {
    try {
      await buy(plan);
    } catch (e) {
      console.error('[billing] buy error', e);
      alert('購入ページに進めませんでした。');
    }
  }, []);
  const handlePortal = useCallback(async () => {
    try {
      await openPortal();
    } catch (e) {
      console.error('[billing] portal error', e);
      alert('支払い設定ページに進めませんでした。');
    }
  }, []);

  // --- サインイン/アウト ---
  const handleGoogleSignIn = useCallback(async () => {
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Supabase の「Site URL/Redirect URLs」にこの URL を登録しておく
          redirectTo: window.location.origin,
        },
      });
    } catch (e) {
      console.error('[auth] signIn error', e);
      alert('ログインに失敗しました。');
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      location.reload();
    } catch (e) {
      console.error('[auth] signOut error', e);
    }
  }, []);

  const remainingLabel = useMemo(() => {
    if (!isAuthed) return null;
    if (loadingRemaining) return '残り … 回';
    if (remaining == null) return null;
    return `残り ${remaining} 回`;
  }, [isAuthed, loadingRemaining, remaining]);

  return (
    <>
      <header className="w-full border-b bg-white">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-3 md:h-16 md:px-6">
          {/* 左：タイトル（元の見た目） */}
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-emerald-700 md:h-7 md:w-7" />
            <div className="flex items-center gap-2 text-sm md:text-base">
              <span className="font-semibold tracking-wide">DRESSUP</span>
              <span className="text-muted-foreground">|</span>
              <span className="text-muted-foreground">AI画像編集ツール</span>
              <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 md:text-xs">
                1.0
              </span>
            </div>
          </div>

          {/* 右：認証状態で出し分け */}
          <div className="flex items-center gap-2">
            {/* 残回数ピル（ログイン時のみ） */}
            {remainingLabel && (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                {remainingLabel}
              </span>
            )}

            {!isAuthed ? (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                title="Googleでログイン"
              >
                <span>→</span>
                <span>Googleでログイン</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleOpenPricing}
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  title="プラン購入"
                >
                  <span className="hidden sm:inline">プラン購入</span>
                  <Wallet className="h-4 w-4 sm:ml-0.5" />
                </button>

                <button
                  type="button"
                  onClick={handlePortal}
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  title="支払い設定"
                >
                  <span className="hidden sm:inline">支払い設定</span>
                </button>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  title="ログアウト"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">ログアウト</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* プラン購入モーダル */}
      <PricingDialog
        open={openPricing}
        onOpenChange={setOpenPricing}
        onBuy={handleBuy}
      />
    </>
  );
};

export default Header;
