// src/components/Header.tsx
import React, { useEffect, useState } from 'react';
import { HelpCircle, LogIn, LogOut, Wallet, ChevronDown } from 'lucide-react';
import { InfoModal } from './InfoModal';
import { buy, openPortal, scheduleDowngrade } from '../lib/billing';
import { supabase } from '../lib/supabaseClient';
import PricingDialog from './PricingDialog';
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

  // 料金モーダル
  const [showPricing, setShowPricing] = useState(false);

  // トースト
  const [toast, setToast] = useState<null | { title: string; desc?: string }>(null);
  const showToast = (title: string, desc?: string) => {
    setToast({ title, desc });
    setTimeout(() => setToast(null), 4500);
  };

  type Tier = 'free' | 'light' | 'basic' | 'pro';

  const tierLabel: Record<Tier, string> = {
    free:  'FREE',
    light: 'ライト',
    basic: 'ベーシック',
    pro:   'プロ',
  };

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
      setSubscriptionTier?.('free');
      return;
    }
    setIsAuthed(true);
    const { data, error } = await supabase
      .from('users')
      .select('credits_total, credits_used, plan')
      .eq('id', uid)
      .single();

    if (!error && data) {
      setRemaining((data.credits_total ?? 0) - (data.credits_used ?? 0));
      const tier = String(data.plan ?? 'free').toLowerCase() as Tier;
      setSubscriptionTier?.(tier);
    }
  };

  useEffect(() => {
    refreshCredits();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshCredits();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Checkout/Portal から戻った時の反映を少し強めに
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const cameFromCheckout = sp.get('checkout') === 'success';
    const cameFromPortal = sp.get('portal') === 'return';
    if (!cameFromCheckout && !cameFromPortal) return;

    refreshCredits();
    const tick = setInterval(refreshCredits, 2000);
    const stop = setTimeout(() => {
      clearInterval(tick);
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
      setSubscriptionTier?.('free');
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async (plan: 'light' | 'basic' | 'pro') => {
    try {
      await buy(plan);
    } catch (e) {
      console.error('[billing] buy error', e);
      alert('購入ページに進めませんでした。');
    }
  };

  // ダウングレード（期末適用）予約 → トースト
  const handleScheduleDowngrade = async (plan: 'light' | 'basic' | 'pro') => {
    try {
      const res = await scheduleDowngrade(plan);
      const when = res.applyAt ? new Date(res.applyAt * 1000) : null;
      const dateLabel = when
        ? `${when.getMonth() + 1}/${when.getDate()} ${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}`
        : '次回請求日';
      showToast('ダウングレードを受け付けました', `「${res.toPlan}」に ${dateLabel} に変更されます。`);
    } catch (e) {
      console.error('[billing] schedule downgrade failed', e);
      showToast('処理に失敗しました', 'しばらくしてから再度お試しください。');
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
                <span
                  className={`rounded-full px-3 py-1 text-sm ${tierClass[subscriptionTier || 'free']}`}
                  title="現在のご利用プラン"
                >
                  {tierLabel[subscriptionTier || 'free']}
                </span>
                <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 text-sm">
                  残り {remaining ?? '-'} 回
                </span>

                {/* モーダル起動 */}
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

      {/* 料金モーダル */}
      <PricingDialog
        open={showPricing}
        onOpenChange={setShowPricing}
        onBuy={handleBuy}
        onScheduleDowngrade={handleScheduleDowngrade}
        currentTier={subscriptionTier || 'free'}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="rounded-xl border border-gray-200 bg-white/95 backdrop-blur px-4 py-3 shadow-xl">
            <div className="font-semibold text-gray-900">{toast.title}</div>
            {toast.desc && <div className="mt-0.5 text-sm text-gray-600">{toast.desc}</div>}
            <div className="mt-2 flex justify-end">
              <button
                className="text-sm text-gray-500 hover:text-gray-700"
                onClick={() => setToast(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
