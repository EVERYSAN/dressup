// src/components/Header.tsx
import React, { useEffect, useState } from 'react';
import { HelpCircle, LogIn, LogOut, Wallet, ChevronDown } from 'lucide-react';
import { InfoModal } from './InfoModal';
import { buy, openPortal } from '../lib/billing';
import { supabase } from '../lib/supabaseClient';
import PricingDialog from './PricingDialog'; // ← 追加
import { useAppStore } from '../store/useAppStore';


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
  const setSubscriptionTier = useAppStore((s) => s.setSubscriptionTier);
  const subscriptionTier = useAppStore((s) => s.subscriptionTier);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // ← 追加：料金モーダルの開閉
  const [showPricing, setShowPricing] = useState(false);

  type Tier = 'free' | 'light' | 'basic' | 'pro';

  const tierLabel: Record<Tier, string> = {
    free:  'FREE',
    light: 'ライト',
    basic: 'ベーシック',
    pro:   'プロ',
  };

  // Tailwind の色はお好みで調整可
  const tierClass: Record<Tier, string> = {
    free:  'bg-gray-100 text-gray-600 border border-gray-200',
    light: 'bg-sky-50 text-sky-700 border border-sky-200',
    basic: 'bg-amber-50 text-amber-700 border border-amber-200',
    pro:   'bg-violet-50 text-violet-700 border border-violet-200',
  };

  const refreshCredits = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      setIsAuthed(false);
      setRemaining(null);
      setSubscriptionTier?.('free');  // ログアウト時は free に戻す
      return;
    }
    setIsAuthed(true);
    const { data, error } = await supabase.from('users')
      .select('credits_total, credits_used, plan')   // ← plan を一緒に取得
      .eq('id', uid)
      .single();
    if (!error && data) {
      setRemaining((data.credits_total ?? 0) - (data.credits_used ?? 0));
      const tier = String(data.plan ?? 'free').toLowerCase() as any;
      setSubscriptionTier?.(tier);    // ← store へ反映：light/basic/pro なら透かしOFF
    }
  };

  useEffect(() => {
    refreshCredits();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshCredits();
    });
    return () => sub.subscription.unsubscribe();
  }, []);
    // ✅ Checkout/Portal から戻った直後に残数を再取得（webhook遅延を吸収）
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const cameFromCheckout = sp.get('checkout') === 'success';
    const cameFromPortal = sp.get('portal') === 'return';
    if (!cameFromCheckout && !cameFromPortal) return;

    // すぐ1回
    refreshCredits();

    // webhook反映まで数秒ポーリング（最大10秒）
    const tick = setInterval(refreshCredits, 2000);
    const stop = setTimeout(() => {
      clearInterval(tick);
      // 見た目のためにクエリを消す（再来訪時に誤検知しない）
      try { window.history.replaceState({}, '', window.location.pathname); } catch {}
    }, 10000);

    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, []);


  const signIn = async () => {
    setLoading(true);
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        // 成功時は同一オリジン（/#access_token で戻ってくる）
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

  // ← 追加：PricingDialog から呼ばれる購入ハンドラ（そのまま buy を呼ぶ）
  const handleBuy = async (plan: 'light' | 'basic' | 'pro') => {
    try {
      await buy(plan);
    } catch (e) {
      console.error('[billing] buy error', e);
      alert('購入ページに進めませんでした。');
    }
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
          <div className="flex items-center gap-2">
            {isAuthed ? (
              <>
                {/* プラン表示 */}
            　  <span
                  className={`rounded-full px-3 py-1 text-sm ${tierClass[subscriptionTier || 'free']}`}
                  title="現在のご利用プラン"
                >
                  {tierLabel[subscriptionTier || 'free']}
                </span>
                <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 text-sm">
                  残り {remaining ?? '-'} 回
                </span>

                {/* プラン購入 → モーダル起動に変更 */}
                <MiniBtn
                  onClick={() => setShowPricing(true)}
                  icon={<ChevronDown size={16} />}
                >
                  プラン購入
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

      {/* 追加：料金モーダル（中央表示・背景スクロール固定はコンポーネント側で制御） */}
      <PricingDialog
        open={showPricing}
        onOpenChange={setShowPricing}
        onBuy={handleBuy}
      />
    </>
  );
};

export default Header;
