import React from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  Edit3,
  Scissors,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { formatKwh } from '../../utils/format';
import type { OverlapCandidate } from '../../db/readingService';
import type { User } from '../../types/models';

interface OverlapDetectionModalProps {
  open: boolean;
  overlappingReadings: OverlapCandidate[];
  enteredPrevTenths: number;
  enteredCurrTenths: number;
  deltaTenths: number;
  affectedCount: number;
  nextCandidate?: OverlapCandidate;
  prevCandidate?: OverlapCandidate;
  users: User[];
  onInsertAndShift: () => void;
  onDeductFromNext: () => void;
  onDeductFromPrev: () => void;
  onKeepAsIs: () => void;
  onEditValue: () => void;
}

export const OverlapDetectionModal: React.FC<OverlapDetectionModalProps> = ({
  open,
  overlappingReadings,
  enteredPrevTenths,
  enteredCurrTenths,
  deltaTenths,
  affectedCount,
  nextCandidate,
  prevCandidate,
  users,
  onInsertAndShift,
  onDeductFromNext,
  onDeductFromPrev,
  onKeepAsIs,
  onEditValue,
}) => {
  const userMap = new Map(users.map((u) => [u.id!, u.name]));

  return (
    <Modal open={open} onClose={onEditValue} title="تنبيه: تداخل مع قراءة مسجلة">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm leading-relaxed">
            <p className="font-bold">
              القراءة الجديدة ({formatKwh(enteredPrevTenths)} ←{' '}
              {formatKwh(enteredCurrTenths)}) تتداخل مع قراءة مسجلة لمستخدم آخر:
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
              {overlappingReadings.map((r) => (
                <li key={r.id}>
                  • <strong>{userMap.get(r.userId) ?? 'مستخدم'}</strong>:{' '}
                  <span className="tabular-nums">
                    {formatKwh(r.prev)} ← {formatKwh(r.curr)}
                  </span>{' '}
                  ({formatKwh(r.consumption)} ك.و)
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-2.5">
          {/* Option 1: Shift all subsequent */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={onInsertAndShift}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-teal-800"
            >
              <ArrowRightLeft className="h-4 w-4 shrink-0" />
              <span>
                إزاحة القراءات اللاحقة كلها (+{formatKwh(deltaTenths)} ك.و)
              </span>
            </button>
            <p className="px-1 text-[11px] text-slate-500">
              تُزاح {affectedCount} قراءة لاحقة للأمام مع بقاء كمية سحب كل مستخدم ثابتة.
            </p>
          </div>

          {/* Option 2: Deduct from next overlapping reading */}
          {nextCandidate && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={onDeductFromNext}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-amber-700"
              >
                <Scissors className="h-4 w-4 shrink-0" />
                <span>
                  خصم التداخل ({formatKwh(deltaTenths)} ك.و) من القراءة التالية
                </span>
              </button>
              <p className="px-1 text-[11px] text-slate-600">
                قراءة <strong>{userMap.get(nextCandidate.userId) ?? 'مستخدم'}</strong> (
                {formatKwh(nextCandidate.prev)} ← {formatKwh(nextCandidate.curr)}) ستصبح{' '}
                <span className="font-bold tabular-nums">
                  {formatKwh(nextCandidate.prev + deltaTenths)} ←{' '}
                  {formatKwh(nextCandidate.curr)}
                </span>{' '}
                (سحب {formatKwh(nextCandidate.consumption - deltaTenths)} ك.و) دون إزاحة
                الباقي.
              </p>
            </div>
          )}

          {/* Option 3: Deduct from previous covering reading */}
          {prevCandidate && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={onDeductFromPrev}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-indigo-700"
              >
                <Scissors className="h-4 w-4 shrink-0" />
                <span>
                  خصم التداخل ({formatKwh(deltaTenths)} ك.و) من القراءة السابقة
                </span>
              </button>
              <p className="px-1 text-[11px] text-slate-600">
                قراءة <strong>{userMap.get(prevCandidate.userId) ?? 'مستخدم'}</strong> (
                {formatKwh(prevCandidate.prev)} ← {formatKwh(prevCandidate.curr)}) ستصبح{' '}
                <span className="font-bold tabular-nums">
                  {formatKwh(prevCandidate.prev)} ←{' '}
                  {formatKwh(prevCandidate.curr - deltaTenths)}
                </span>{' '}
                (سحب {formatKwh(prevCandidate.consumption - deltaTenths)} ك.و) دون إزاحة
                الباقي.
              </p>
            </div>
          )}

          {/* Option 4: Keep as is */}
          <button
            type="button"
            onClick={onKeepAsIs}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Check className="h-4 w-4" />
            <span>حفظ القراءة كما هي بدون تعديل البقية</span>
          </button>

          <button
            type="button"
            onClick={onEditValue}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            <Edit3 className="h-4 w-4" />
            <span>العودة لتصحيح الرقم</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
