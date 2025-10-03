// src/components/BillingSummaryCard.tsx
import { useBillingSummary } from '@/hooks/useBillingSummary';

const PlanBadge: React.FC<{plan?: string}> = ({ plan }) => {
  const color =
    plan === 'pro'   ? 'bg-purple-600' :
    plan === 'basic' ? 'bg-blue-600'   :
    plan === 'light' ? 'bg-emerald-600': 'bg-slate-500';
  return (
    <span className={`${color} text-white text-xs px-2 py-0.5 rounded-full`}>
      {plan ?? '—'}
    </span>
  );
};

export default function BillingSummaryCard() {
  const { loading, error, usage, remaining, periodDate, pending, cancelSchedule } =
    useBillingSummary();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="rounded-xl border border-slate-200 bg-white/60 dark:bg-slate-900/40 p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">
              ご利用状況
            </h3>
            <PlanBadge plan={usage?.plan} />
          </div>
          {loading && <span className="text-xs text-slate-500">読み込み中…</span>}
        </div>

        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}

        {!loading && !error && usage && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 p-3">
              <div className="text-slate-500">現在のプラン</div>
              <div className="mt-1 font-medium">{usage.plan}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 p-3">
              <div className="text-slate-500">残り回数</div>
              <div className="mt-1 font-medium">
                {remaining} / {usage.credits_total}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 p-3">
              <div className="text-slate-500">更新日</div>
              <div className="mt-1 font-medium">
                {periodDate ? periodDate.toLocaleDateString() : '—'}
              </div>
            </div>
          </div>
        )}

        {/* 予約中のダウングレード */}
        {pending?.hasPending && (
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3">
            <div className="text-sm">
              <span className="font-semibold">ダウングレード予約中：</span>
              <span className="ml-1">次回請求日に「{pending.toPlan}」へ変更</span>
              {pending.effectiveDate && (
                <span className="ml-2 text-slate-600">
                  ({new Date(pending.effectiveDate * 1000).toLocaleDateString()})
                </span>
              )}
            </div>
            <button
              onClick={cancelSchedule}
              className="self-start sm:self-auto rounded-md border border-amber-400 px-3 py-1.5 text-sm hover:bg-amber-100 dark:hover:bg-amber-800/30"
            >
              予約を取り消す
            </button>
          </div>
        )}
        {pending?.hasPending && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
              <span className="text-sm font-medium text-amber-800">
                予定されている変更
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-amber-900">
                {pending.currentPlan} → <span className="font-semibold">{pending.nextPlan ?? '—'}</span>
              </div>
              <div className="text-sm text-amber-900">
                適用日：{pending.effectiveAt
                  ? new Date(pending.effectiveAt * 1000).toLocaleDateString('ja-JP')
                  : '—'}
              </div>
            </div>
            <p className="mt-1 text-xs text-amber-700">
              ※次回請求日（更新日）に自動で反映されます。直前までに再度プランを変更することで、上書きも可能です。
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
