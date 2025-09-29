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
