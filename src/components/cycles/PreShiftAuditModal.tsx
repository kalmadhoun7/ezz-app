import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { getPreCloseSnapshot } from '../../db/closingEngine';
import { formatDateTimeAr, formatKwh } from '../../utils/format';
import type { CycleSnapshotPayload, User } from '../../types/models';

interface PreShiftAuditModalProps {
  cycleId: number | null;
  users: User[];
  onClose: () => void;
}

export const PreShiftAuditModal: React.FC<PreShiftAuditModalProps> = ({
  cycleId,
  users,
  onClose,
}) => {
  const [payload, setPayload] = useState<CycleSnapshotPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const userMap = new Map(users.map((u) => [u.id!, u.name]));

  useEffect(() => {
    if (cycleId !== null) {
      setLoading(true);
      getPreCloseSnapshot(cycleId)
        .then(setPayload)
        .finally(() => setLoading(false));
    } else {
      setPayload(null);
    }
  }, [cycleId]);

  return (
    <Modal
      open={cycleId !== null}
      onClose={onClose}
      title="النسخة الأصلية قبل الإزاحة (للمدير فقط)"
      maxWidthClass="max-w-xl"
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">جارٍ التحميل...</p>
      ) : !payload ? (
        <p className="py-6 text-center text-sm text-slate-500">
          لا توجد نسخة أصلية محفوظة لهذه الدورة.
        </p>
      ) : (
        <div className="space-y-4 text-xs">
          <div>
            <h4 className="mb-2 font-bold text-slate-800">
              القراءات الأصلية ({payload.readings.length})
            </h4>
            <div className="space-y-1.5">
              {payload.readings.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                >
                  <div>
                    <span className="font-bold text-slate-900">
                      {userMap.get(r.user_id) ?? 'مستخدم'}
                    </span>
                    <p className="text-[11px] text-slate-500">
                      {formatDateTimeAr(r.recorded_at)}
                    </p>
                  </div>
                  <div className="text-left tabular-nums">
                    <p className="font-bold text-slate-800">
                      {formatKwh(r.prev_reading_tenths)} ← {formatKwh(r.curr_reading_tenths)}
                    </p>
                    <p className="text-teal-700">{formatKwh(r.consumption_tenths)} ك.و</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {payload.pending_gaps.length > 0 && (
            <div>
              <h4 className="mb-2 font-bold text-amber-900">
                الفجوات قبل الإقفال ({payload.pending_gaps.length})
              </h4>
              <div className="space-y-1.5">
                {payload.pending_gaps.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-2.5"
                  >
                    <span>
                      {formatKwh(g.from_reading_tenths)} ← {formatKwh(g.to_reading_tenths)}
                    </span>
                    <span className="font-bold tabular-nums text-amber-800">
                      {formatKwh(g.gap_tenths)} ك.و
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
