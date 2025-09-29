// src/components/Header.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { openPortal, buy } from '../lib/billing';
import PricingDialog from './PricingDialog';

type PlanKey = 'light' | 'basic' | 'pro';

type CreditsRow = {
  credits_total: number | null;
  credits_used: number | null;
};

export const Header: React.FC = () => {
  const [openPricing, setOpenPricing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  // --- 1) ハッシュからトークンを引き取ってセッションを復元（Header 内で完結） ---
  useEffect(() => {
    const bootstrapFromHash = async () => {
      if (!location.hash.includes('access_token=')) return;
      const params = new URLSearchParams(location.hash.slice(1));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        try {
          await supabase.auth.setSession({ access_token, refresh_token });
        } catch (e) {
          console.error('[auth] setSession from hash failed', e);
        }
      }
      history.replaceState(null, '', location.pathname + location.search);
    };
    bootstrapFromHash();
  }, []);

  // --- 2) セッション監視 & 残り回数ロード ---
  const loadCredits = useCallback(
    async (uid: string) => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('credits_total, credits_used')
          .eq('id', uid) // ← テーブルの主キー 'id' を使用
          .single<CreditsRow>();
        if (error) throw error;
        const total = data?.credits_total ?? 0;
        const used = data?.credits_used ?? 0;
        setRemaining(Math.max(0, total - used));
      } catch (e) {
        console.error('[credits] load failed', e);
        setRemaining(null);
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (!mounted) return;

      setUserId(uid);
      if (uid) await loadCredits(uid);
      setLoading(false);
    };

    init();

    // auth 変化を追う
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) loadCredits(uid);
      else setRemaining(null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadCredits]);

  // --- 3) UI ハンドラ ---
  const handleOpenPricing = () => setOpenPricing(true);

  const handleBuy = async (plan: PlanKey) => {
    try {
      await buy(plan);
    } catch (e) {
      console.error('[billing] buy error', e);
      alert('購入ページに進めませんでした。');
    }
  };

  const handlePortal = async () => {
    try {
      await openPortal();
    } catch (e) {
      console.error('[billing] portal error', e);
      alert('支払い設定ページに進めませんでした。');
    }
  };

  const handleSignIn = async () => {
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // ハッシュフローでも Header 側で復元するので OK
          redirectTo: window.location.origin,
        },
      });
    } catch (e) {
      console.error('[auth] signIn error', e);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      location.reload();
    } catch (e) {
      console.error('[auth] signOut error', e);
    }
  };

  const creditsPill = useMemo(() => {
    if (loading) return null;
    if (!userId) return null;
    const label =
      remaining === null ? '残り - 回' : `残り ${remaining} 回`;
    return (
      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        {label}
      </span>
    );
  }, [loading, userId, remaining]);

  return (
    <>
      <header className="w-full border-b bg-white">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-3 md:h-16 md:px-6">
          {/* 左：タイトル（元の表示に戻す） */}
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

          {/* 右：操作類 */}
          <div className="flex items-center gap-2">
            {/* 残り回数ピル（ログイン時のみ） */}
            {creditsPill}

            {/* ログインしていない場合は Google ログインだけ表示 */}
            {!userId ? (
              <button
                type="button"
                onClick={handleSignIn}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <span>Googleでログイン</span>
              </button>
            ) : (
              <>
                {/* プラン購入（モーダル） */}
                <button
                  type="button"
                  onClick={handleOpenPricing}
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="hidden sm:inline">プラン購入</span>
                  <Wallet className="h-4 w-4 sm:ml-0.5" />
                </button>

                {/* 支払い設定（Stripe ポータル） */}
                <button
                  type="button"
                  onClick={handlePortal}
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="hidden sm:inline">支払い設定</span>
                </button>

                {/* ログアウト */}
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

      {/* 料金モーダル */}
      <PricingDialog
        open={openPricing}
        onOpenChange={setOpenPricing}
        onBuy={(plan) => handleBuy(plan as PlanKey)}
      />
    </>
  );
};

export default Header;
