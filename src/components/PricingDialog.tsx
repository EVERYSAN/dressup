// src/components/PricingDialog.tsx
import React from 'react';
import { X } from 'lucide-react';

type Tier = 'free' | 'light' | 'basic' | 'pro';
const rank: Record<Tier, number> = { free: 0, light: 1, basic: 2, pro: 3 };

export default function PricingDialog({
  open,
  onOpenChange,
  onBuy,               // アップグレード即時
  onScheduleDowngrade, 
  currentTier, // 現在のユーザープラン
  pendingNote,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onBuy: (plan: 'light' | 'basic' | 'pro') => Promise<void>;
  onScheduleDowngrade: (plan: 'light' | 'basic' | 'pro') => Promise<void>; // ★ 追加
  currentTier: Tier;
  pendingNote?: {
    fromPlan: 'light' | 'basic' | 'pro' | 'free';
　  toPlan:   'light' | 'basic' | 'pro';
    effectiveAt?: number; // unix(sec)
  };
}) {
  if (!open) return null;

  const handleClick = async (plan: 'light' | 'basic' | 'pro') => {
    try {
      if (rank[plan] < rank[currentTier]) {
        // ↓↓↓ ダウングレードは期末にスケジュール
        await onScheduleDowngrade(plan);
        onOpenChange(false);
      } else {
        // ↑↑↑ アップグレードは即時購入
        await onBuy(plan);
      }
    } catch (e) {
      console.error(e);
      alert('処理に失敗しました。しばらくしてからお試しください。');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="mx-3 w-full max-w-5xl rounded-lg bg-white shadow-xl ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
          <h2 className="text-base font-semibold md:text-lg">プラン一覧</h2>
          <button
            className="rounded p-1 hover:bg-accent"
            onClick={() => onOpenChange(false)}
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* ダウングレード予約中の通知（任意表示） */}
         {pendingNote && (
           <div className="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:mx-6">
             <span className="font-medium">ダウングレード予約中：</span>
             <span className="ml-1">{pendingNote.fromPlan} → <b>{pendingNote.toPlan}</b></span>
             {typeof pendingNote.effectiveAt === 'number' && (
               <span className="ml-2 text-amber-800">
                 （適用日 {new Date(pendingNote.effectiveAt * 1000).toLocaleDateString('ja-JP')}）
               </span>
             )}
           </div>
         )}

        <div className="max-h-[80vh] overflow-y-auto px-4 py-5 md:px-6">
          <div className="grid gap-6 md:grid-cols-3">
            <PlanCard
              title="ライト"
              price="¥1,500/月"
              bullets={['フリマアプリ出品者、小規模ECショップ向け']}
              features={['100回/月', '透かし解除']}
              cta="ライトで始める"
              onClick={() => handleClick('light')}
            />
            <PlanCard
              title="ベーシック"
              price="¥6,000/月"
              bullets={['月間数百点の商品画像を扱う店舗（古着屋・雑貨屋）向け']}
              features={['500回/月', '透かし解除']}
              cta="ベーシックに申し込む"
              onClick={() => handleClick('basic')}
            />
            <PlanCard
              title="プロ"
              price="¥14,000/月"
              bullets={['中規模ブランド、複数店舗展開してる事業者向け']}
              features={['1200回/月', '透かし解除']}
              cta="プロに申し込む"
              onClick={() => handleClick('pro')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  title,
  price,
  bullets,
  features,
  cta,
  onClick,
}: {
  title: string;
  price: string;
  bullets: string[];
  features: string[];
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col rounded-lg border p-5 shadow-sm">
      <div>
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="mt-1 text-lg font-semibold">{price}</div>
      </div>

      <ul className="mt-3 space-y-1 text-sm leading-relaxed text-muted-foreground">
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      <ul className="mt-4 space-y-1 text-sm">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1 inline-block h-[6px] w-[6px] rounded-full bg-emerald-600" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onClick}
        className="mt-5 inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        {cta}
      </button>
    </div>
  );
}
