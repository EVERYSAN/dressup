import React, { useEffect, useState } from 'react';
import { HelpCircle, LogIn, LogOut, Wallet } from 'lucide-react';
import PricingDialog from './PricingDialog';              // ← デフォルトimport（モーダル）
import { buy, openPortal } from '../lib/billing';
import { supabase } from '../lib/supabaseClient';

function MiniBtn(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }
) {
  const { icon, children, className = '', ...rest } = props;
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export const Header: React.FC = () => {
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showPricing, setShowPricing] = useState(false);  // ← モーダル開閉
  const [isAuthed, setIsAuthed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshCredits = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      setIsAuthed(false);
      setRemaining(null);
      return;
    }
    setIsAuthed(true);
    const { data, error } = await supabase
      .from('users')
      .select('credits_total, credits_used')
      .eq('id', uid)                                  // ← すでに id カラムで運用中
      .single();
    if (!error && data) {
      setRemaining((data.credits_total ?? 0) - (data.credits_used ?? 0));
    }
  };

  useEffect(() => {
    refreshCredits();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refreshCredits());
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    setLoading(true);
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      setIsAuthed(false);
      setRemaining(null);
    } finally {
      setLoading(false);
    }
  };

  // PricingDialog 内の「申し込む」ボタンから呼ばれる
  const handleBuy = (plan: 'light' | 'basic' | 'pro') => {
    setShowPricing(false);
    buy(plan); // API→Stripe Checkout（フロントでBearer付与済み）
  };

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
        {/* 左：タイトル（黒バッジ版に戻す） */}
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-semibold text-black hidden md:block">
            DRESSUP | AI画像編集ツール
          </h1>
          <h1 className="text-xl font-semibold text-black md:hidden">DRESSUP</h1>
          <div className="text-xs text-gray-500 bg-gray-800 text-white px-2 py-1 rounded">1.0</div>
        </div>

        {/* 右：残数/購入/支払い/認証/ヘルプ */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            {isAuthed ? (
              <>
                <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 text-sm">
                  残り {remaining ?? '-'} 回
                </span>

                {/* プラン購入 → PricingDialog を開く */}
                <MiniBtn onClick={() => setShowPricing(true)}>
                  プラン購入
                </MiniBtn>

                {/* Stripe Customer Portal */}
                <MiniBtn onClick={openPortal} icon={<Wallet size={16} />}>
                  支払い設定
                </MiniBtn>

                <MiniBtn onClick={signOut} icon={<LogOut size={16} />}>
                  ログアウト
                </MiniBtn>
              </>
            ) : (
              <MiniBtn onClick={signIn} disabled={loading} icon={<LogIn size={16} />}>
                {loading ? '…' : 'Googleでログイン'}
              </MiniBtn>
            )}
          </div>

          <button
            className="rounded-md p-2 hover:bg-gray-100"
            onClick={() => setShowInfoModal(true)}
            aria-label="ヘルプ"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* 料金モーダル（幅広・カード3枚のやつ） */}
      <PricingDialog
        open={showPricing}
        onOpenChange={setShowPricing}
        onSelectPlan={handleBuy}
      />

      {/* 既存のヘルプモーダル */}
      {/* InfoModal は既存実装をそのまま使ってください */}
      {/* <InfoModal open={showInfoModal} onOpenChange={setShowInfoModal} /> */}
    </>
  );
};

export default Header;
