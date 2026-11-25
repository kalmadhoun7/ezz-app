import React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { formatCurrency, formatDateTimeAr, formatKwh } from '../../utils/format';
import { computeAmountAgorot } from '../../utils/math';
import type { Reading, Settings } from '../../types/models';

interface UserCycleReadingsModalProps {
  open: boolean;
  userId: number | null;
  userName: string;
  cycleTitle: string;
  readings: Reading[];
  kwhPriceAgorot: number;
  settings: Settings;
  onClose: () => void;
  onAddReadingForUser: (userId: number) => void;
  onEditReading: (reading: Reading) => void;
  onDeleteReading: (reading: Reading) => void;
}

export const UserCycleReadingsModal: React.FC<UserCycleReadingsModalProps> = ({
  open,
  userId,
  userName,
  cycleTitle,
  readings,
  kwhPriceAgorot,
  settings,
  onClose,
  onAddReadingForUser,
  onEditReading,
  onDeleteReading,
}) => {
  const totalKwh = readings.reduce((s, r) => s + r.consumption_tenths, 0);
  const totalAmount = computeAmountAgorot(totalKwh, kwhPriceAgorot);
  const sorted = [...readings].sort((a, b) => {
    const t = b.recorded_at.localeCompare(a.recorded_at);
    return t !== 0 ? t : (b.id ?? 0) - (a.id ?? 0);
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`تسجيلات ${userName}${cycleTitle ? ` — ${cycleTitle}` : ''}`}
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-4">
        {/* Summary Header */}
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-teal-100 bg-teal-50/70 p-3 text-center">
          <div>
            <p className="text-[11px] font-semibold text-teal-700">عدد التسجيلات</p>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-teal-950">
              {readings.length}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-teal-700">إجمالي السحب</p>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-teal-950">
              {formatKwh(totalKwh)} ك.و
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-teal-700">التكلفة التقديرية</p>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-teal-950">
              {formatCurrency(totalAmount)} {settings.currency_symbol}
            </p>
          </div>
        </div>

        {userId !== null && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onAddReadingForUser(userId);
            }}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white shadow-xs transition hover:bg-teal-800"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة قراءة جديدة لـ {userName}</span>
          </button>
        )}

        {/* Individual Readings */}
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            لا توجد تسجيلات لهذا المستخدم في الدورة.
          </p>
        ) : (
          <div className="space-y-2">
            {sorted.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold tabular-nums text-teal-800">
                      {formatKwh(r.consumption_tenths)} ك.و
                    </span>
                    {r.linked_sub_reading_id && (
                      <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">
                        فرعي متزامن
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs font-semibold tabular-nums text-slate-600">
                    {formatKwh(r.prev_reading_tenths)} ← {formatKwh(r.curr_reading_tenths)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {formatDateTimeAr(r.recorded_at)}
                    {r.notes ? ` • ${r.notes}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="تعديل القراءة"
                    onClick={() => onEditReading(r)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-teal-700"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="حذف القراءة"
                    onClick={() => onDeleteReading(r)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
