import React from 'react';
import { Check } from 'lucide-react';

type PlanKey = 'light' | 'basic' | 'pro';

export type PricingPlan = {
  key: PlanKey;
  name: string;
  priceLabel: string; // "¥1,500/月" など
  blurb?: string;     // 上の短い説明
  bullets: string[];  // 箇条書き
  cta?: string;       // ボタン文言（既定: 参加する / 申し込む）
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plans: PricingPlan[];
  onSelect: (plan: PlanKey) => void; // buy('light' | 'basic' | 'pro')
};

export default function PricingDialog({ open, onOpenChange, plans, onSelect }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-5xl rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold">プランを選択</h2>
          <button
            className="rounded-full px-3 py-1 text-sm text-gray-500 hover:bg-gray-100"
            onClick={() => onOpenChange(false)}
          >
            閉じる
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.key}
              className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="mb-3 text-sm font-semibold text-teal-600">{p.name}</div>

              <div className="mb-2 text-2xl font-bold">{p.priceLabel}</div>

              {p.blurb && <p className="mb-4 text-sm leading-relaxed text-gray-600">{p.blurb}</p>}

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
      </div>
    </div>
  );
}
