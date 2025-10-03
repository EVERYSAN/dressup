import { useState, useMemo } from 'react';
import { AlertCircle, Clock } from 'lucide-react';
import BillingSummaryCard from '@/components/BillingSummaryCard';

type Props = {
  planLabel: string;          // 例: "light" / "basic" / "pro"
  remaining: number;          // 例: 100
  total: number;              // 例: 100
  nextRenewAt?: number | null; // UNIX秒（なければ null）
  hasPending?: boolean;       // 期末に変更予約があるか
};

export default function BillingSummaryInline({
  planLabel, remaining, total, nextRenewAt, hasPending,
}: Props) {
  const [open, setOpen] = useState(false);

  const dateText = useMemo(() => {
    if (!nextRenewAt) return '—';
    const d = new Date(nextRenewAt * 1000);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }, [nextRenewAt]);

  // 何も出す必要がなければ何も描画しない（邪魔にしない）
  if (!hasPending && !nextRenewAt) return null;

  return (
    <>
      {/* コンパクトなピル */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs
                   bg-white/70 backdrop-blur hover:bg-white shadow-sm transition"
        title="プラン情報を表示"
      >
        {hasPending ? (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
            <span className="font-medium">変更予約あり</span>
          </>
        ) : (
          <>
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-medium">次回 {dateText}</span>
          </>
        )}
        <span className="text-slate-500">・</span>
        <span className="capitalize">{planLabel}</span>
        <span className="text-slate-500">・</span>
        <span>{remaining}/{total}</span>
      </button>

      {/* モーダル（Radix UI/Dialog や HeadlessUI/Modal を使っていればそちらに置き換え） */}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
             onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl"
               onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-5 py-3 font-semibold">プラン情報</div>
            <div className="p-5">
              <BillingSummaryCard />
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
                      onClick={() => setOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
