import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { db } from '../../db/database';
import { getCycleOrDateRangeReport, type UserCycleReportRow } from '../../db/reportService';
import { formatCurrency, formatDateTimeAr, formatKwh } from '../../utils/format';
import type { Cycle, Reading, Settings, User } from '../../types/models';

interface FinalCycleViewModalProps {
  cycle: Cycle | null;
  users: User[];
  settings: Settings;
  onClose: () => void;
}

export const FinalCycleViewModal: React.FC<FinalCycleViewModalProps> = ({
  cycle,
  users,
  settings,
  onClose,
}) => {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [userRows, setUserRows] = useState<UserCycleReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  const userMap = new Map(users.map((u) => [u.id!, u.name]));

  useEffect(() => {
    if (!cycle?.id) {
      setReadings([]);
      setUserRows([]);
      return;
    }
    setLoading(true);
    Promise.all([
      db.readings
        .where('cycle_id')
        .equals(cycle.id)
        .filter((r) => r.meter_id === cycle.meter_id)
        .toArray()
        .then((arr) =>
          arr.sort(
            (a, b) =>
              a.prev_reading_tenths - b.prev_reading_tenths ||
              a.curr_reading_tenths - b.curr_reading_tenths ||
              (a.id ?? 0) - (b.id ?? 0)
          )
        ),
      getCycleOrDateRangeReport({
        mainMeterId: cycle.meter_id,
        cycleId: cycle.id,
      }),
    ])
      .then(([finalReadings, report]) => {
        setReadings(finalReadings);
        setUserRows(report.rows);
      })
      .finally(() => setLoading(false));
  }, [cycle?.id, cycle?.meter_id]);

  return (
    <Modal
      open={!!cycle}
      onClose={onClose}
      title={`النسخة النهائية — ${cycle?.title ?? ''}`}
      maxWidthClass="max-w-xl"
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">جارٍ التحميل...</p>
      ) : (
        <div className="space-y-4 text-xs">
          {/* User Totals Summary */}
          <div>
            <h4 className="mb-2 font-bold text-slate-800">
              ملخص المستخدمين النهائي ({userRows.length})
            </h4>
            <div className="space-y-1.5">
              {userRows.map((row) => (
                <div
                  key={row.userId}
                  className="flex items-center justify-between rounded-xl border border-teal-100 bg-teal-50/50 p-2.5"
                >
                  <span className="font-bold text-slate-900">{row.userName}</span>
                  <div className="text-left tabular-nums">
                    <span className="font-bold text-teal-800">
                      {formatKwh(row.consumptionTenths)} ك.و
                    </span>
                    <span className="mx-1.5 text-slate-300">|</span>
                    <span className="font-bold text-slate-800">
                      {formatCurrency(row.netAmountAgorot)} {settings.currency_symbol}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Final Readings List */}
          <div>
            <h4 className="mb-2 font-bold text-slate-800">
              القراءات النهائية ({readings.length})
            </h4>
            <div className="space-y-1.5">
              {readings.map((r) => (
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
        </div>
      )}
    </Modal>
  );
};
