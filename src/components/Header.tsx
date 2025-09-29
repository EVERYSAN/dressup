import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { openPortal, buy } from '../lib/billing';
import { useAppStore } from '../store/useAppStore';

// PricingDialog を遅延読み込みしつつ、default / named どちらでも受け取れるように吸収
const PricingDialogLazy = React.lazy(async () => {
  const mod = await import('./PricingDialog');
  const Comp =
    // default export 優先、なければ named export を拾う
    (mod as any).default ?? (mod as any).PricingDialog;

  if (!Comp) {
    // 何かの理由でコンポーネントが見つからない場合はダミーを返す
    console.error(
      '[Header] PricingDialog component not found. ' +
        'Ensure PricingDialog.tsx exports either `export default` or `export const PricingDialog`.'
    );
    return { default: () => null };
  }
  return { default: Comp as React.ComponentType<any> };
});

export function Header() {
  const [pricingOpen, setPricingOpen] = useState(false);

  const { user } = useAppStore((s) => ({ user: s.user }));
  const remaining = useMemo(() => {
    const total = user?.credits_total ?? 0;
    const used = user?.credits_used ?? 0;
    return Math.max(0, total - used);
  }, [user]);

  const handleOpenPricing = useCallback(() => setPricingOpen(true), []);
  const handleClosePricing = useCallback(() => setPricingOpen(false), []);

  const handleSelectPlan = useCallback(async (plan: 'light' | 'basic' | 'pro') => {
    try {
      await buy(plan);        // Stripe Checkout 起動
      setPricingOpen(false);
    } catch (e: any) {
      alert(`購入フローを開始できませんでした:\n${e?.message ?? e}`);
    }
  }, []);

  const handleOpenPortal = useCallback(async () => {
    try {
      await openPortal();     // Stripe カスタマーポータル
    } catch (e: any) {
      alert(`支払い設定ページに進めませんでした:\n${e?.message ?? e}`);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
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
        <button
          type="button"
          onClick={handleOpenPricing}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          プラン購入
        </button>

        <button
          type="button"
          onClick={handleOpenPortal}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          title="支払い方法の変更・解約など"
        >
          <Wallet className="h-4 w-4" />
          <span>支払い設定</span>
        </button>

        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <LogOut className="h-4 w-4" />
          <span>ログアウト</span>
        </button>
      </div>

      {/* プライシングのモーダル（どちらの export でも動く） */}
      <Suspense fallback={null}>
        {pricingOpen && (
          <PricingDialogLazy
            open={pricingOpen}
            onClose={handleClosePricing}
            onSelect={handleSelectPlan}
          />
        )}
      </Suspense>
    </header>
  );
}
