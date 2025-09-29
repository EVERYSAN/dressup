// src/components/Header.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import PricingDialog from './PricingDialog'; // ← default import（ファイル側が default export）
import { supabase } from '../lib/supabaseClient';
import { openPortal, buy } from '../lib/billing';
import { useAppStore } from '../store/useAppStore'; // ← named export 前提

type PlanKey = 'light' | 'basic' | 'pro';

export const Header: React.FC = () => {
  const { user, creditsRemaining } = useAppStore(); // ストアに無ければ適宜削ってOK
  const [pricingOpen, setPricingOpen] = useState(false);
  const [busy, setBusy] = useState<'portal' | 'logout' | null>(null);
import React, { useState } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { openPortal, buy } from '../lib/billing';
import PricingDialog, { PricingDialog as PricingDialogNamed } from './PricingDialog';

type PlanKey = 'light' | 'basic' | 'pro';

export const Header: React.FC = () => {
  const [openPricing, setOpenPricing] = useState(false);

  // 料金表のモーダルを開く
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

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      // 画面をリロードして状態をリセット
      location.reload();
    } catch (e) {
      console.error('[auth] signOut error', e);
    }
  };

  return (
    <>
      <header className="w-full border-b bg-white">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-3 md:h-16 md:px-6">

          {/* ==== 左：アプリタイトル（以前の表示に戻す） ==== */}
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

          {/* ==== 右：操作ボタン ==== */}
          <div className="flex items-center gap-2">
            {/* プラン購入（モーダルを開く） */}
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
          </div>
        </div>
      </header>

      {/* 料金モーダル（中央にしっかり表示・スクロール固定） */}
      <PricingDialog
        open={openPricing}
        onOpenChange={setOpenPricing}
        onBuy={handleBuy}
      />
    </>
  );
};

// どちらの import でも使えるように両方 export
export default Header;
  const isLoggedIn = !!user;

  const handleLogout = useCallback(async () => {
    try {
      setBusy('logout');
      await supabase.auth.signOut();
      // 画面更新はアプリ側の auth 監視に任せる
    } finally {
      setBusy(null);
    }
  }, []);

  const handleOpenPortal = useCallback(async () => {
    try {
      setBusy('portal');
      await openPortal();
    } catch (e) {
      console.error(e);
      alert('ポータルの起動に失敗しました。Stripe のポータル設定（本番）を保存済みか確認してください。');
    } finally {
      setBusy(null);
    }
  }, []);

  const handleSelectPlan = useCallback(async (plan: PlanKey) => {
    try {
      await buy(plan); // サーバ側で price id を選択して Checkout 起動
    } catch (e) {
      console.error(e);
      alert('チェックアウトの起動に失敗しました。');
    } finally {
      setPricingOpen(false);
    }
  }, []);

  const creditBadge = useMemo(() => {
    if (typeof creditsRemaining === 'number') {
      return (
        <span className="ml-2 rounded-full bg-emerald-700/90 text-white text-xs px-2 py-0.5">
          残り {creditsRemaining}
        </span>
      );
    }
    return null;
  }, [creditsRemaining]);

  return (
    <header className="w-full border-b border-gray-200 bg-white/70 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-7xl px-3 sm:px-4 md:px-6">
        <div className="h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-emerald-600" />
            <div className="text-sm font-bold tracking-wide">DRESSUP</div>
            {creditBadge}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* プラン購入（モーダルを開く） */}
            <button
              type="button"
              onClick={() => setPricingOpen(true)}
              className="rounded-lg border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 px-3 py-1.5 text-sm font-medium"
            >
              プラン購入
            </button>

            {/* 支払い設定（Stripe カスタマーポータル） */}
            <button
              type="button"
              onClick={handleOpenPortal}
              disabled={!isLoggedIn || busy === 'portal'}
              className="inline-flex items-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              title={isLoggedIn ? '支払い設定を開く' : 'ログインするとご利用いただけます'}
            >
              <Wallet className="h-4 w-4 mr-1.5" />
              支払い設定
            </button>

            {/* ログアウト */}
            {isLoggedIn && (
              <button
                type="button"
                onClick={handleLogout}
                disabled={busy === 'logout'}
                className="ml-1 inline-flex items-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50 px-3 py-1.5 text-sm"
              >
                <LogOut className="h-4 w-4 mr-1.5" />
                ログアウト
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pricing モーダル */}
      <PricingDialog
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        onSelect={handleSelectPlan}
      />
    </header>
  );
};

// 必要なら default も出す（App 側が default import していた場合の互換）
export default Header;
