// src/components/Header.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { HelpCircle, LogIn, LogOut, Wallet, ChevronDown } from 'lucide-react';
import { InfoModal } from './InfoModal';
import { buy, openPortal, scheduleDowngrade } from '../lib/billing';
import { supabase } from '../lib/supabaseClient';
import PricingDialog from './PricingDialog';
import { useAppStore } from '../store/useAppStore';
import BillingSummaryCard from '@/components/BillingSummaryCard';


// ↓ 既存 state 群の下に追加


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
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null);
  const [periodEndUnix, setPeriodEndUnix] = useState<number | null>(null);

  // 料金モーダル
  const [showPricing, setShowPricing] = useState(false);
  // ▼ 追加：モバイルの「…」メニュー開閉
  const [menuOpen, setMenuOpen] = useState(false);
  
  // メニューはリサイズ/スクロールで自動クローズ
  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
  };
}, []);
  // 追加（派生値）
  const currentPlanLabel = (subscriptionTier || 'free'); // 'free' | 'light' | 'basic' | 'pro'
  const remainingCredits = remaining;                    // number | null


  // トースト
  // トースト（位置可変対応）
type ToastPos = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center';

const [toast, setToast] = useState<null | { title: string; desc?: string }>(null);
const [toastPos, setToastPos] = useState<ToastPos>('bottom-right');

// 位置も渡せる showToast
const showToast = (title: string, desc?: string, pos: ToastPos = 'bottom-right') => {
  setToastPos(pos);
  setToast({ title, desc });
  setTimeout(() => setToast(null), 4500);
};

// 位置に応じたコンテナのクラス計算
const toastContainerClass = (pos: ToastPos) => {
  switch (pos) {
    case 'top-right':
      return 'fixed top-4 right-4';
    case 'top-left':
      return 'fixed top-4 left-4';
    case 'bottom-left':
      return 'fixed bottom-4 left-4';
    case 'center':
      // 画面中央（スマホ/PC共通）
      return 'fixed inset-0 flex items-center justify-center';
    default:
      return 'fixed bottom-4 right-4';
  }
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
      .select('credits_total, credits_used, plan, period_end')
      .eq('id', uid)
      .single();

    if (!error && data) {
      setRemaining((data.credits_total ?? 0) - (data.credits_used ?? 0));
      const tier = String(data.plan ?? 'free').toLowerCase() as Tier;
      setSubscriptionTier?.(tier);
      setCreditsTotal(data.credits_total ?? null);
        const pe =
          typeof data.period_end === 'number'
            ? data.period_end
            : data.period_end
              ? Math.floor(new Date(data.period_end as any).getTime() / 1000)
              : null;
        setPeriodEndUnix(pe);
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

  useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('upgraded') === '1') {
    const pos = window.innerWidth < 768 ? 'center' : 'top-right';
    showToast('アップグレード完了', 'ご利用可能回数が増えました。', pos);
    params.delete('upgraded');
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }
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
      const pos = window.innerWidth < 768 ? 'center' : 'top-right';
      showToast('ダウングレードを受け付けました', `「${res.toPlan}」に次回請求日に変更されます。`, pos);
      await loadPendingChange();
      await refreshCredits();
    } catch (e) {
      console.error('[billing] schedule downgrade failed', e);
      const pos = window.innerWidth < 768 ? 'center' : 'top-right';
      showToast('処理に失敗しました', 'しばらくしてから再度お試しください。', pos);
    }
  };

  // Header 内の関数群の下に配置
// Header.tsx 内（関数群の下にある loadPendingChange を置き換え）
// Header.tsx 内（関数群の下あたり）
const loadPendingChange = async () => {
  try {
    setPendingLoading(true);

    // Supabase のアクセストークンを取得
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const res = await fetch('/api/stripe/pending-change', {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(String(res.status));

    const data = await res.json(); // { toPlan?: 'light'|'basic'|'pro', applyAt?: number|null }
    if (data?.toPlan) {
      setPending({ toPlan: data.toPlan, applyAt: data.applyAt ?? null });
    } else {
      setPending(null);
    }
  } catch (e) {
    console.warn('[pending-change] fetch failed', e);
    setPending(null);
  } finally {
    setPendingLoading(false);
  }
};



  return (
    <>
      <header className="h-14 md:h-16 bg-white border-b border-gray-200 flex items-center justify-between px-3 md:px-6">
        {/* 左：タイトル */}
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <h1 className="text-base md:text-xl font-semibold text-black hidden md:block whitespace-nowrap overflow-hidden text-ellipsis">
            DRESSUP | AI画像編集ツール
          </h1>
          <h1 className="text-base md:text-xl font-semibold text-black md:hidden whitespace-nowrap">
            DRESSUP
          </h1>
          <div className="text-[10px] md:text-xs text-gray-50 bg-gray-800 px-1.5 py-0.5 md:px-2 md:py-1 rounded">
            1.0
          </div>
        </div>

        {/* 右：購入/残数/支払い/認証/ヘルプ */}
        <div className="flex items-center gap-2 md:gap-8 min-w-0">
          {/* --- モバイル（md未満）：コンパクト表示 --- */}
          <div className="flex items-center gap-2 md:hidden">
            {isAuthed ? (
              <>
                {/* プラン＋残回数を1ピルに統合 */}
                <span
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs border ${tierClass[subscriptionTier || 'free']}`}
                  title="現在のご利用プラン / 残回数"
                >
                  {tierLabel[subscriptionTier || 'free']} ・ 残り {remaining ?? '-'} 回
                </span>
        
                {/* 3点リーダーメニュー：購入 / Portal / ログアウト */}
                <div className="relative">
                  <button
                    className="rounded-md border border-gray-300 p-1.5 text-sm hover:bg-gray-50"
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="メニューを開く"
                  >
                    ⋯
                  </button>
                  {menuOpen && (
                    <div
                      className="absolute right-0 z-40 mt-2 w-48 rounded-md border border-gray-200 bg-white shadow-lg"
                      onMouseLeave={() => setMenuOpen(false)}
                    >
                      <button
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => { setShowPricing(true); setMenuOpen(false); }}
                      >
                        新規プラン購入
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => { openPortal(); setMenuOpen(false); }}
                      >
                        プラン変更/解約
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => { signOut(); setMenuOpen(false); }}
                      >
                        ログアウト
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <MiniBtn onClick={signIn} disabled={loading} icon={<LogIn size={16} />}>
                {loading ? '…' : 'ログイン'}
              </MiniBtn>
            )}
          </div>
        
          {/* --- PC（md以上）：従来の横並び --- */}
          <div className="hidden md:flex items-center gap-2">
            {isAuthed ? (
              <>
                <span
                  className={`rounded-full px-3 py-1 text-sm whitespace-nowrap ${tierClass[subscriptionTier || 'free']}`}
                  title="現在のご利用プラン"
                >
                  {tierLabel[subscriptionTier || 'free']}
                </span>
                <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 text-sm whitespace-nowrap">
                  残り {remaining ?? '-'} 回
                </span>
        
                <MiniBtn onClick={() => setShowPricing(true)} icon={<ChevronDown size={16} />}>
                  新規プラン購入
                </MiniBtn>
                <MiniBtn onClick={openPortal} icon={<Wallet size={16} />}>
                  プラン変更/解約
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
        
          {/* ヘルプ（共通） */}
          <button
            className="rounded-md p-2 hover:bg-gray-100 shrink-0"
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
      {/* Toast */}
      {toast && (
        <div className={`${toastContainerClass(toastPos)} z-50`}>
          <div className="rounded-xl border border-gray-200 bg-white/95 backdrop-blur px-4 py-3 shadow-xl
                          max-w-[92vw] sm:max-w-md w-[min(92vw,28rem)] pointer-events-auto">
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
