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
