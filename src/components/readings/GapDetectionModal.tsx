import React, { useState } from 'react';
import { AlertTriangle, Clock, UserCheck, Edit3 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { formatKwh } from '../../utils/format';
import type { User } from '../../types/models';

interface GapDetectionModalProps {
  open: boolean;
  lastRecordedTenths: number;
  enteredPrevTenths: number;
  gapTenths: number;
  users: User[];
  onSaveAsPendingGap: () => void;
  onAssignToUser: (userId: number) => void;
  onEditValue: () => void;
}

export const GapDetectionModal: React.FC<GapDetectionModalProps> = ({
  open,
  lastRecordedTenths,
  enteredPrevTenths,
  gapTenths,
  users,
  onSaveAsPendingGap,
  onAssignToUser,
  onEditValue,
}) => {
  const [selectedGapUserId, setSelectedGapUserId] = useState<number>(
    users[0]?.id ?? 0
  );

  return (
    <Modal open={open} onClose={onEditValue} title="تنبيه: اكتشاف فجوة في القراءة">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm leading-relaxed">
            <p className="font-bold">
              يوجد فرق غير مسجل بمقدار{' '}
              <span className="tabular-nums text-amber-700">
                {formatKwh(gapTenths)} ك.و
              </span>
            </p>
            <p className="mt-1 text-xs text-amber-800">
              آخر قراءة مسجلة على العداد الرئيسي:{' '}
              <strong className="tabular-nums">{formatKwh(lastRecordedTenths)}</strong>
              {' — '}القراءة السابقة المُدخلة:{' '}
              <strong className="tabular-nums">{formatKwh(enteredPrevTenths)}</strong>
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={onSaveAsPendingGap}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-amber-700"
          >
            <Clock className="h-4 w-4" />
            <span>حفظ كفجوة معلّقة للمعالجة لاحقاً</span>
          </button>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
            <p className="text-xs font-bold text-slate-700">
              أو إسناد الفجوة لمستخدم الآن كقراءة طبيعية:
            </p>
            <div className="flex gap-2">
              <select
                value={selectedGapUserId || (users[0]?.id ?? '')}
                onChange={(e) => setSelectedGapUserId(Number(e.target.value))}
                className="min-h-[44px] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedGapUserId && !users[0]?.id}
                onClick={() => onAssignToUser(selectedGapUserId || users[0]?.id!)}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white transition hover:bg-teal-800 disabled:opacity-50"
              >
                <UserCheck className="h-4 w-4" />
                <span>إسناد وحفظ</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onEditValue}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Edit3 className="h-4 w-4" />
            <span>العودة لتصحيح الرقم</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
