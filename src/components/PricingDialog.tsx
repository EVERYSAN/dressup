// src/components/PricingDialog.tsx
import React from 'react';
import { Check } from 'lucide-react';

type PlanKey = 'light' | 'basic' | 'pro';

type Props = {
  open: boolean;
  onClose: () => void;                 // ← onOpenChange を onClose に統一
  onSelect: (plan: PlanKey) => void;   // ← Header から buy(plan) を呼んでもらう
};

// 表示用のプラン定義（必要に応じて書き換えてOK）
const PLANS: {
  key: PlanKey;
  name: string;
  priceLabel: string;   // "¥1,500/月" など
  blurb?: string;
  bullets: string[];
  cta?: string;
}[] = [
  {
    key: 'light',
    name: 'ライトプラン',
    priceLabel: '¥980 / 月',
    blurb: 'まずはお試しに最適',
    bullets: ['月10回まで', '標準サポート'],
    cta: 'ライトで始める',
  },
  {
    key: 'basic',
    name: 'ベーシックプラン',
    priceLabel: '¥1,980 / 月',
    blurb: '日常利用にちょうどいい',
    bullets: ['月100回まで', '優先サポート', '履歴の保存'],
    cta: 'ベーシックに申し込む',
  },
  {
    key: 'pro',
    name: 'プロプラン',
    priceLabel: '¥3,980 / 月',
    blurb: 'ヘビーユース向け',
    bullets: ['無制限*', '最優先サポート', '高度な機能'],
    cta: 'プロに申し込む',
  },
];

export default function PricingDialog({ open, onClose, onSelect }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold">プランを選択</h2>
          <button
            className="rounded-full px-3 py-1 text-sm text-gray-500 hover:bg-gray-100"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.key}
              className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-3 text-sm font-semibold text-teal-600">{p.name}</div>
              <div className="mb-2 text-2xl font-bold">{p.priceLabel}</div>
              {p.blurb && (
                <p className="mb-4 text-sm leading-relaxed text-gray-600">{p.blurb}</p>
              )}

              <div className="mb-5 space-y-2">
                {p.bullets.map((b, i) => (
                  <div key={i} className="flex gap-2 text-sm text-gray-700">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-teal-600" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>

              <button
                className="mt-auto rounded-xl bg-teal-600 px-4 py-2.5 text-white hover:bg-teal-700"
                onClick={() => onSelect(p.key)}
              >
                {p.cta ?? '申し込む'}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-gray-500">
          *異常な負荷が見られる場合はフェアユース制限が適用されることがあります。
        </p>
      </div>
    </div>
  );
}
