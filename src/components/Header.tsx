import React, { useEffect, useState, useCallback } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { openPortal, buy } from '../lib/billing';
import PricingDialog from './PricingDialog';

type PlanKey = 'light' | 'basic' | 'pro';

export const Header: React.FC = () => {
  const [openPricing, setOpenPricing] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  // --- auth 状態を監視（初期表示 & 以降の変化） ---
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setIsAuthed(!!data.session);
    };
    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setIsAuthed(!!session);
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // --- モーダル開閉 ---
  const handleOpenPricing = useCallback(() => setOpenPricing(true), []);

  // --- 課金系 ---
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

  // --- サインイン / サインアウト ---
  const handleGoogleSignIn = useCallback(async () => {
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
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
      location.reload(); // 状態をリセット
    } catch (e) {
      console.error('[auth] signOut error', e);
    }
  }, []);

  return (
    <>
      <header className="w-full border-b bg-white">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-3 md:h-16 md:px-6">
          {/* ==== 左：アプリタイトル（元の見た目） ==== */}
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

          {/* ==== 右：認証状態で出し分け ==== */}
          <div className="flex items-center gap-2">
            {!isAuthed ? (
              // 未ログイン：Google ログイン
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                title="Googleでログイン"
              >
                <span className="i-mdi:login" />
                <span>Googleでログイン</span>
              </button>
            ) : (
              // ログイン済み：プラン購入 / 支払い設定 / ログアウト
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

      {/* 課金モーダル */}
      <PricingDialog open={openPricing} onOpenChange={setOpenPricing} onBuy={handleBuy} />
    </>
  );
};

// どちらの import 方式でも使えるように
export default Header;
