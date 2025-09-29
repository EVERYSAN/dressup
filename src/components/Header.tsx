// src/components/Header.tsx
import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle, LogIn, LogOut, Wallet, ChevronDown } from 'lucide-react';
import { InfoModal } from './InfoModal';
import { buy } from '../lib/billing';
import { openPortal } from '../lib/billing';
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

function PlanMenu({
  onPick,
}: {
  onPick: (plan: 'light' | 'basic' | 'pro') => void;
}) {
  // 価格やクレジット目安はUI表示用（Stripeの金額と必ず合わせる）
  const items = [
    { key: 'light' as const, title: 'ライト', desc: '100回/月 フリマアプリ出品者、小規模ECショップ 透かし解除', price: '¥1,500/月' },
    { key: 'basic' as const, title: 'ベーシック', desc: '500回/月　月間数百点の商品画像を扱う店舗（古着屋・雑貨屋）向け　透かし解除', price: '¥6,000/月' },
    { key: 'pro' as const, title: 'プロ', desc: '1200回/月　中規模ブランド、複数店舗展開してる事業者向け　透かし解除', price: '¥14,000/月' },
  ];
  return (
    <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-gray-200 bg-white shadow-lg z-50">
      <div className="py-1">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => onPick(it.key)}
            className="w-full text-left px-3 py-2 hover:bg-gray-50"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium">{it.title}</div>
              <div className="text-xs text-gray-500">{it.price}</div>
            </div>
            <div className="text-xs text-gray-500">{it.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export const Header: React.FC = () => {
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // プランメニュー
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

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
      setRemaining((data.credits_total ?? 0) - (data.credits_used ?? 0));
    }
  };

  useEffect(() => {
    refreshCredits();
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
      setIsAuthed(false);
      setRemaining(null);
    } finally {
      setLoading(false);
    }
  };

  const pickPlan = (plan: 'light' | 'basic' | 'pro') => {
    setMenuOpen(false);
    buy(plan); // → Stripe Checkout へ
  };

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
        {/* 左：タイトル */}
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-semibold text-black hidden md:block">
            DRESSUP | AI画像編集ツール
          </h1>
          <h1 className="text-xl font-semibold text-black md:hidden">DRESSUP</h1>
          <div className="text-xs text-gray-500 bg-gray-800 text-white px-2 py-1 rounded">1.0</div>
        </div>

        {/* 右：購入/残数/支払い/認証/ヘルプ */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 relative" ref={menuRef}>
            {isAuthed ? (
              <>
                <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 text-sm">
                  残り {remaining ?? '-'} 回
                </span>

                {/* プラン購入（ドロップダウン） */}
                <MiniBtn
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                  }}
                  icon={<ChevronDown size={16} />}
                >
                  プラン購入
                </MiniBtn>
                {menuOpen && <PlanMenu onPick={pickPlan} />}

                {/* 支払い設定（Customer Portal） */}
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
