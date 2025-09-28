// src/components/Header.tsx
import React, { useEffect, useState } from 'react';
import { HelpCircle, LogIn, LogOut, CreditCard, Wallet } from 'lucide-react';
import { InfoModal } from './InfoModal';
import { buy, openPortal } from '../lib/billing';
import { supabase } from '../lib/supabaseClient';

// 共通の小さめボタン
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
  const [isAuthed, setIsAuthed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // 残り回数の取得
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
      .eq('id', uid)
      .single();
    if (!error && data) {
      const rest = (data.credits_total ?? 0) - (data.credits_used ?? 0);
      setRemaining(rest);
    }
  };

  useEffect(() => {
    // 初期取得
    refreshCredits();
    // ログイン状態の変更を監視
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshCredits();
    });
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
      setRemaining(null);
      setIsAuthed(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
        {/* 左側：タイトル + バージョン */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-semibold text-black hidden md:block">
              DRESSUP | AI画像編集ツール
            </h1>
            <h1 className="text-xl font-semibold text-black md:hidden">
              DRESSUP
            </h1>
          </div>
          <div className="text-xs text-gray-500 bg-gray-800 text-white px-2 py-1 rounded">
            1.0
          </div>
        </div>

        {/* 右側：ヘルプ + 課金/認証エリア */}
        <div className="flex items-center gap-8">
          {/* 課金/認証 */}
          <div className="flex items-center gap-2">
            {isAuthed ? (
              <>
                {/* 残り回数バッジ */}
                <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 text-sm">
                  残り {remaining ?? '-'} 回
                </span>
                {/* 購入系 */}
                <MiniBtn onClick={() => buy('basic')} icon={<CreditCard size={16} />}>
                  Basic購入
                </MiniBtn>
                <MiniBtn onClick={() => buy('pro')} icon={<CreditCard size={16} />}>
                  Pro購入
                </MiniBtn>
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

      <InfoModal open={showInfoModal} onOpenChange={setShowInfoModal} />
    </>
  );
};
