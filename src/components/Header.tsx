// src/components/Header.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import PricingDialog from './PricingDialog'; // ← default import に統一
import { supabase } from '../lib/supabaseClient';
import { openPortal, buy } from '../lib/billing';
import { useAppStore } from '../store/useAppStore'; // ← あなたの実パスに合わせて

type PlanKey = 'light' | 'basic' | 'pro';

// 安全ガード：もし誤って undefined を JSX に渡しても落ちないように
function guardElementType(Comp: any, name: string): React.ComponentType<any> {
  const ok =
    Comp &&
    (typeof Comp === 'function' ||
      (typeof Comp === 'object' && (Comp as any).$$typeof && String((Comp as any).$$typeof).includes('react')));
  if (!ok) {
    console.error(`[Header] Invalid component for ${name}. Got:`, Comp);
    return () => null;
  }
  return Comp as React.ComponentType<any>;
}

const SafePricingDialog = guardElementType(PricingDialog, 'PricingDialog');

function HeaderImpl() {
  const [pricingOpen, setPricingOpen] = useState(false);
  const { user } = useAppStore((s) => ({ user: s.user }));

  const remaining = useMemo(() => {
    const total = user?.credits_total ?? 0;
    const used = user?.credits_used ?? 0;
    return Math.max(0, total - used);
  }, [user]);

  const handleOpenPricing = useCallback(() => setPricingOpen(true), []);
  const handleClosePricing = useCallback(() => setPricingOpen(false), []);

  const handleSelectPlan = useCallback(async (plan: PlanKey) => {
    try {
      await buy(plan);
      setPricingOpen(false);
    } catch (e: any) {
      console.error('[Header] buy(plan) failed:', e);
      alert(`購入フローを開始できませんでした:\n${e?.message ?? e}`);
    }
  }, []);

  const handleOpenPortal = useCallback(async () => {
    try {
      await openPortal();
    } catch (e: any) {
      console.error('[Header] openPortal() failed:', e);
      alert(`支払い設定ページに進めませんでした:\n${e?.message ?? e}`);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      location.reload();
    } catch (e: any) {
      console.error('[Header] logout failed:', e);
      alert(`ログアウトに失敗しました:\n${e?.message ?? e}`);
    }
  }, []);

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
          残り {remaining} 回
        </span>
      </div>

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

      <SafePricingDialog
        open={pricingOpen}
        onClose={handleClosePricing}
        onSelect={handleSelectPlan}
      />
    </header>
  );
}

// App.tsx が { Header } で読み込んでも、default で読んでも動くよう両方出す
export const Header = HeaderImpl;
export default HeaderImpl;
