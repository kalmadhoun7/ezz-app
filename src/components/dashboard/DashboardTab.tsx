import React, { useMemo, useState } from 'react';
import {
  Plus,
  AlertTriangle,
  Zap,
  Calendar,
  ArrowUpLeft,
  ChevronLeft,
} from 'lucide-react';
import { formatCurrency, formatDateAr, formatDateTimeAr, formatKwh } from '../../utils/format';
import { computeAmountAgorot } from '../../utils/math';
import { deleteReading } from '../../db/readingService';
import { EditReadingModal } from '../readings/EditReadingModal';
import { UserCycleReadingsModal } from './UserCycleReadingsModal';
import type { Cycle, Meter, PendingGap, Reading, Settings, User } from '../../types/models';

interface DashboardTabProps {
  activeMainMeter: Meter | undefined;
  openCycle: Cycle | undefined;
  readings: Reading[];
  pendingGaps: PendingGap[];
  users: User[];
  settings: Settings;
  onAddReadingClick: (preselectedUserId?: number) => void;
  onOpenCycleClick: () => void;
  onGoToCycles: () => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  activeMainMeter,
  openCycle,
  readings,
  pendingGaps,
  users,
  settings,
  onAddReadingClick,
  onOpenCycleClick,
  onGoToCycles,
}) => {
  const [editingReading, setEditingReading] = useState<Reading | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showAllUsers, setShowAllUsers] = useState(false);
  const userMap = new Map(users.map((u) => [u.id!, u.name]));

  const lastReadingCurr =
    readings.length > 0
      ? Math.max(
          openCycle?.opening_reading_tenths ?? 0,
          ...readings.map((r) => r.curr_reading_tenths)
        )
      : openCycle?.opening_reading_tenths ?? 0;

  const totalConsumptionTenths = readings.reduce(
    (sum, r) => sum + r.consumption_tenths,
    0
  );

  // Group readings by user so each user appears once in the cycle list, sorted by most recent activity
  const groupedByUser = useMemo(() => {
    const map = new Map<
      number,
      {
        userId: number;
        userName: string;
        readings: Reading[];
        totalKwhTenths: number;
        latestRecordedAt: string;
        latestId: number;
      }
    >();

    for (const r of readings) {
      const existing = map.get(r.user_id);
      if (existing) {
        existing.readings.push(r);
        existing.totalKwhTenths += r.consumption_tenths;
        if (
          r.recorded_at > existing.latestRecordedAt ||
          (r.recorded_at === existing.latestRecordedAt && (r.id ?? 0) > existing.latestId)
        ) {
          existing.latestRecordedAt = r.recorded_at;
          existing.latestId = r.id ?? 0;
        }
      } else {
        map.set(r.user_id, {
          userId: r.user_id,
          userName: userMap.get(r.user_id) ?? 'مستخدم',
          readings: [r],
          totalKwhTenths: r.consumption_tenths,
          latestRecordedAt: r.recorded_at,
          latestId: r.id ?? 0,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const t = b.latestRecordedAt.localeCompare(a.latestRecordedAt);
      return t !== 0 ? t : b.latestId - a.latestId;
    });
  }, [readings, users]);

  const visibleGroups = showAllUsers ? groupedByUser : groupedByUser.slice(0, 5);
  const selectedUserGroup =
    selectedUserId !== null
      ? groupedByUser.find((g) => g.userId === selectedUserId) ?? null
      : null;

  const handleDelete = async (r: Reading) => {
    const label = r.linked_sub_reading_id
      ? 'هل تريد حذف هذه القراءة؟ سيتم حذف القراءة المرتبطة في العداد الفرعي أيضاً.'
      : 'هل تريد حذف هذه القراءة؟';
    if (!window.confirm(label)) return;
    await deleteReading(r.id!);
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Open Cycle Card */}
      {openCycle ? (
        <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-700 to-teal-800 p-4 text-white shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold text-teal-100">
                <Zap className="h-3 w-3" />
                دورة مفتوحة
              </span>
              <h2 className="mt-1.5 text-lg font-bold">{openCycle.title}</h2>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-teal-100">
                <Calendar className="h-3.5 w-3.5" />
                <span>بدأت في {formatDateAr(openCycle.start_date)}</span>
              </p>
            </div>
            <div className="rounded-xl bg-white/15 px-3 py-1.5 text-left">
              <p className="text-[10px] text-teal-100">سعر الكيلو</p>
              <p className="text-sm font-bold tabular-nums">
                {formatCurrency(openCycle.kwh_price_agorot)} {settings.currency_symbol}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-black/15 p-3 text-center">
            <div>
              <p className="text-[11px] text-teal-100">الافتتاحية</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums">
                {formatKwh(openCycle.opening_reading_tenths)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-teal-100">آخر قراءة</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums">
                {formatKwh(lastReadingCurr)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-teal-100">إجمالي السحب</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-teal-200">
                {formatKwh(totalConsumptionTenths)} ك.و
              </p>
            </div>
          </div>

          {pendingGaps.length > 0 && (
            <button
              type="button"
              onClick={onGoToCycles}
              className="mt-3 flex min-h-[44px] w-full items-center justify-between rounded-xl bg-amber-500/95 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-amber-500"
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                يوجد {pendingGaps.length} فجوة معلّقة بحاجة للمعالجة
              </span>
              <ArrowUpLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center space-y-3">
          <p className="text-base font-bold text-slate-800">
            لا توجد دورة مفتوحة حالياً
          </p>
          <p className="text-xs text-slate-500">
            {activeMainMeter
              ? `افتح دورة جديدة للعداد "${activeMainMeter.name}" لبدء تسجيل القراءات.`
              : 'أضف عداداً رئيسياً أولاً.'}
          </p>
          {activeMainMeter && (
            <button
              type="button"
              onClick={onOpenCycleClick}
              className="min-h-[44px] rounded-xl bg-teal-700 px-5 text-sm font-bold text-white hover:bg-teal-800"
            >
              + فتح دورة جديدة
            </button>
          )}
        </div>
      )}

      {/* Readings Grouped By User */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">
            استهلاك المستخدمين في الدورة
          </h3>
          <span className="text-xs font-semibold text-slate-500">
            {groupedByUser.length} مستخدم • {readings.length} قراءة
          </span>
        </div>

        {visibleGroups.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-500">
            لم تُسجل أي قراءات في هذه الدورة بعد.
          </div>
        ) : (
          <div className="space-y-2">
            {visibleGroups.map((g) => {
              const estAmount = openCycle
                ? computeAmountAgorot(g.totalKwhTenths, openCycle.kwh_price_agorot)
                : 0;
              return (
                <button
                  key={g.userId}
                  type="button"
                  onClick={() => setSelectedUserId(g.userId)}
                  className="flex min-h-[58px] w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 text-right shadow-2xs transition hover:border-teal-300 hover:bg-teal-50/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-900">
                        {g.userName}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        {g.readings.length}{' '}
                        {g.readings.length === 1 ? 'تسجيل' : 'تسجيلات'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      آخر قراءة: {formatDateTimeAr(g.latestRecordedAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="text-left tabular-nums">
                      <p className="text-sm font-bold text-teal-700">
                        {formatKwh(g.totalKwhTenths)} ك.و
                      </p>
                      <p className="text-[11px] font-semibold text-slate-500">
                        {formatCurrency(estAmount)} {settings.currency_symbol}
                      </p>
                    </div>
                    <ChevronLeft className="h-4 w-4 text-slate-400" />
                  </div>
                </button>
              );
            })}

            {groupedByUser.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllUsers((v) => !v)}
                className="min-h-[44px] w-full rounded-2xl border border-slate-300 bg-white px-4 text-xs font-bold text-teal-800 transition hover:bg-slate-50"
              >
                {showAllUsers
                  ? 'عرض أحدث 5 مستخدمين فقط'
                  : `عرض جميع المستخدمين (${groupedByUser.length})`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Prominent FAB */}
      {openCycle && (
        <button
          type="button"
          onClick={() => onAddReadingClick()}
          className="fixed bottom-20 left-4 z-20 flex min-h-[52px] items-center gap-2 rounded-2xl bg-teal-700 px-5 text-sm font-bold text-white shadow-lg transition hover:bg-teal-800 active:scale-[0.98] sm:left-[calc(50%-20rem+1rem)]"
        >
          <Plus className="h-5 w-5" />
          <span>تسجيل قراءة جديدة</span>
        </button>
      )}

      <UserCycleReadingsModal
        open={!!selectedUserGroup}
        userId={selectedUserGroup?.userId ?? null}
        userName={selectedUserGroup?.userName ?? ''}
        cycleTitle={openCycle?.title ?? ''}
        readings={selectedUserGroup?.readings ?? []}
        kwhPriceAgorot={openCycle?.kwh_price_agorot ?? settings.default_kwh_price_agorot}
        settings={settings}
        onClose={() => setSelectedUserId(null)}
        onAddReadingForUser={(uid) => onAddReadingClick(uid)}
        onEditReading={(r) => setEditingReading(r)}
        onDeleteReading={handleDelete}
      />

      <EditReadingModal
        reading={editingReading}
        users={users}
        onClose={() => setEditingReading(null)}
        onSaved={() => {}}
      />
    </div>
  );
};
