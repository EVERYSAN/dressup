// src/components/Header.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import PricingDialog from './PricingDialog';
import { supabase } from '../lib/supabaseClient';
import { openPortal } from '../lib/billing';
import {useAppStore} from '../store/useAppStore';

/**
 * ヘッダー
 * - 残り回数バッジ
 * - プラン購入 => PricingDialog をモーダル表示
 * - 支払い設定（Stripe カスタマーポータル）
 * - ログアウト
 */
export function Header() {
  const [pricingOpen, setPricingOpen] = useState(false);

  // 残回数は store の users テーブル相当の値から算出
  const { user } = useAppStore((s) => ({ user: s.user }));
  const remaining = useMemo(() => {
    const total = user?.credits_total ?? 0;
    const used = user?.credits_used ?? 0;
    return Math.max(0, total - used);
  }, [user]);

  const handleOpenPricing = useCallback(() => setPricingOpen(true), []);
  const handleClosePricing = useCallback(() => setPricingOpen(false), []);

  const handleOpenPortal = useCallback(async () => {
    try {
      await openPortal(); // 失敗時は内部で throw
    } catch (e: any) {
      alert(`支払い設定ページに進めませんでした:\n${e?.message ?? e}`);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      // ページをリロードしてセッション反映
      location.reload();
    } catch (e: any) {
      alert(`ログアウトに失敗しました:\n${e?.message ?? e}`);
    }
  }, []);

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3">
      {/* 左：残回数 */}
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
          残り {remaining} 回
        </span>
      </div>

      {/* 右：操作ボタン群 */}
      <div className="flex items-center gap-2">
        {/* プラン購入 → PricingDialog を開く */}
        <button
          type="button"
          onClick={handleOpenPricing}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <span>プラン購入</span>
        </button>

        {/* 支払い設定（Stripe カスタマーポータル） */}
        <button
          type="button"
          onClick={handleOpenPortal}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          title="支払い方法の変更・解約など"
        >
          <Wallet className="h-4 w-4" />
          <span>支払い設定</span>
        </button>

        {/* ログアウト */}
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <LogOut className="h-4 w-4" />
          <span>ログアウト</span>
        </button>
      </div>

      {/* プライシングのモーダル */}
      <PricingDialog open={pricingOpen} onClose={handleClosePricing} />
    </header>
  );
}
