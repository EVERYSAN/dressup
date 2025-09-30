import React from 'react';
import { X } from 'lucide-react';

type PlanKey = 'light' | 'basic' | 'pro';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBuy: (plan: PlanKey) => void;
};

/**
 * 料金ダイアログ
 * - 画面中央に固定
 * - 背景スクロールを抑止
 * - ダイアログ内部だけ縦スクロール可能
 */
export const PricingDialog: React.FC<Props> = ({ open, onOpenChange, onBuy }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={() => onOpenChange(false)}
    >
      {/* コンテンツ */}
      <div
        className="mx-3 w-full max-w-5xl rounded-lg bg-white shadow-xl ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
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

        {/* 本文（縦スクロール許可） */}
        <div className="max-h-[80vh] overflow-y-auto px-4 py-5 md:px-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* ライト */}
            <PlanCard
              title="ライト"
              price="¥1,500/月"
              bullets={[
                'フリマアプリ出品者、小規模ECショップ向け',
              ]}
              features={['100回/月','透かし解除']}
              cta="ライトで始める"
              onClick={() => onBuy('light')}
            />
            {/* ベーシック */}
            <PlanCard
              title="ベーシック"
              price="¥6,000/月"
              bullets={[
                '月間数百点の商品画像を扱う店舗（古着屋・雑貨屋）向け',
              ]}
              features={['500回/月','透かし解除']}
              cta="ベーシックに申し込む"
              onClick={() => onBuy('basic')}
            />
            {/* プロ */}
            <PlanCard
              title="プロ"
              price="¥14,000/月"
              bullets={[
                '中規模ブランド、複数店舗展開してる事業者向け',
              ]}
              features={['1200回/月','透かし解除']}
              cta="プロに申し込む"
              onClick={() => onBuy('pro')}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

type CardProps = {
  title: string;
  price: string;
  bullets: string[];
  features: string[];
  note?: string;
  cta: string;
  onClick: () => void;
};

const PlanCard: React.FC<CardProps> = ({
  title,
  price,
  bullets,
  features,
  note,
  cta,
  onClick,
}) => {
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

      {note && (
        <p className="mt-3 text-xs text-muted-foreground">
          {note}
        </p>
      )}

      <button
        type="button"
        onClick={onClick}
        className="mt-5 inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        {cta}
      </button>
    </div>
  );
};

// どちらの import でも OK
export default PricingDialog;
