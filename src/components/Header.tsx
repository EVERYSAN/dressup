// src/components/Header.tsx
import React, { useEffect, useState } from 'react';
import { HelpCircle, LogIn, LogOut, Wallet } from 'lucide-react';
import { InfoModal } from './InfoModal';
import { openPortal, buy } from '../lib/billing';
import { supabase } from '../lib/supabaseClient';
import PricingDialog from './PricingDialog'; // ← 料金表モーダル（default export 前提）

/** 小さめの汎用ボタン */
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
  const [openPricing, setOpenPricing] = useState(false);

  const [isAuthed, setIsAuthed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // 残回数を Supabase から取得
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
      .eq('id', uid) // 既存スキーマに合わせる
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

  // 認証
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
      // location.reload(); // 必要ならリロード
    } finally {
      setLoading(false);
    }
  };

  // 料金表内の「申し込む」ボタンから呼ばれる
  const handleBuy = async (plan: 'light' | 'basic' | 'pro') => {
    try {
      await buy(plan);
    } catch (e) {
      console.error('[billing] buy error', e);
      alert('購入ページに進めませんでした。');
    }
  };

  // 支払いポータル
  const handlePortal = async () => {
    try {
      await openPortal();
    } catch (e) {
      console.error('[billing] portal error', e);
      alert('支払い設定ページに進めませんでした。');
    }
  };

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
        {/* 左：タイトル（以前の見た目を踏襲） */}
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-semibold text-black hidden md:block">
            DRESSUP | AI画像編集ツール
          </h1>
          <h1 className="text-xl font-semibold text-black md:hidden">DRESSUP</h1>
          <div className="text-xs text-gray-500 bg-gray-800 text-white px-2 py-1 rounded">1.0</div>
        </div>

        {/* 右：残回数 / プラン購入(モーダル) / 支払い設定 / 認証 / ヘルプ */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            {isAuthed ? (
              <>
                {/* 残回数 */}
                <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 text-sm">
                  残り {remaining ?? '-'} 回
                </span>

                {/* プラン購入 → 料金モーダルを開く */}
                <MiniBtn onClick={() => setOpenPricing(true)}>
                  プラン購入
                </MiniBtn>

                {/* 支払い設定（Stripe Customer Portal） */}
                <MiniBtn onClick={handlePortal} icon={<Wallet size={16} />}>
                  支払い設定
                </MiniBtn>

                {/* ログアウト */}
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

          {/* ヘルプ */}
          <button
            className="rounded-md p-2 hover:bg-gray-100"
            onClick={() => setShowInfoModal(true)}
            aria-label="ヘルプ"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* 使い方 */}
      <InfoModal open={showInfoModal} onOpenChange={setShowInfoModal} />

      {/* 料金表モーダル（中央配置・スクロール固定） */}
      <PricingDialog
        open={openPricing}
        onOpenChange={setOpenPricing}
        onBuy={handleBuy}
      />
    </>
  );
};

export default Header;
