import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Eye,
  FileCheck2,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  SearchCheck,
  UserCheck,
} from 'lucide-react';
import { db } from '../../db/database';
import { formatCurrency, formatDateAr, formatDateTimeAr, formatKwh } from '../../utils/format';
import {
  addReading,
  resolveOverlapBetweenReadings,
  resolvePendingGapToUser,
} from '../../db/readingService';
import { updateCycleTitle } from '../../db/cycleService';
import {
  analyzeCycleDiscrepancies,
  applyPostCloseShift,
  reopenCycle,
} from '../../db/closingEngine';
import { Modal } from '../common/Modal';
import { PreShiftAuditModal } from './PreShiftAuditModal';
import { FinalCycleViewModal } from './FinalCycleViewModal';
import type { Cycle, PendingGap, Reading, Settings, User } from '../../types/models';

interface CyclesTabProps {
  openCycle: Cycle | undefined;
  closedCycles: Cycle[];
  readings: Reading[];
  pendingGaps: PendingGap[];
  users: User[];
  settings: Settings;
  onOpenCycleClick: () => void;
  onStartClosingWizard?: () => void;
}

export const CyclesTab: React.FC<CyclesTabProps> = ({
  openCycle,
  closedCycles,
  readings,
  pendingGaps,
  users,
  settings,
  onOpenCycleClick,
  onStartClosingWizard,
}) => {
  const [assigningGapId, setAssigningGapId] = useState<number | null>(null);
  const [assigningInternalKey, setAssigningInternalKey] = useState<string | null>(null);
  const [assignUserId, setAssignUserId] = useState<number>(users[0]?.id ?? 0);
  const [auditCycleId, setAuditCycleId] = useState<number | null>(null);
  const [finalViewCycle, setFinalViewCycle] = useState<Cycle | null>(null);
  const [reopenError, setReopenError] = useState('');
  const [showScanResults, setShowScanResults] = useState(false);
  const [editingCycle, setEditingCycle] = useState<Cycle | null>(null);
  const [editTitleStr, setEditTitleStr] = useState('');
  const [editTitleErr, setEditTitleErr] = useState('');

  const allAdjustments = useLiveQuery(() => db.cycle_user_adjustments.toArray()) ?? [];
  const cyclesWithPendingShift = useMemo(() => {
    const set = new Set<number>();
    for (const a of allAdjustments) {
      if ((a.reallocation_kwh_tenths ?? 0) !== 0) {
        set.add(a.cycle_id);
      }
    }
    return set;
  }, [allAdjustments]);

  const openEditTitle = (c: Cycle) => {
    setEditingCycle(c);
    setEditTitleStr(c.title);
    setEditTitleErr('');
  };

  const handleSaveCycleTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCycle?.id) return;
    try {
      await updateCycleTitle(editingCycle.id, editTitleStr);
      setEditingCycle(null);
    } catch (err) {
      setEditTitleErr(err instanceof Error ? err.message : 'تعذر تعديل الاسم');
    }
  };

  const lastMainCurr = useMemo(() => {
    if (!openCycle) return 0;
    return readings.length > 0
      ? Math.max(
          openCycle.opening_reading_tenths,
          ...readings.map((r) => r.curr_reading_tenths)
        )
      : openCycle.opening_reading_tenths;
  }, [openCycle, readings]);

  const scanReport = useMemo(() => {
    if (!openCycle) return null;
    return analyzeCycleDiscrepancies(
      readings,
      [],
      pendingGaps,
      openCycle.opening_reading_tenths,
      lastMainCurr
    );
  }, [openCycle, readings, pendingGaps, lastMainCurr]);

  const internalAndOverlapItems = useMemo(
    () =>
      (scanReport?.items ?? []).filter(
        (i) => i.kind === 'INTERNAL_GAP' || i.kind === 'OVERLAP'
      ),
    [scanReport]
  );

  const handleAssignInternalGap = async (
    fromTenths: number,
    toTenths: number,
    detectedAt?: string
  ) => {
    const uid = assignUserId || users[0]?.id;
    if (!uid || !openCycle) return;
    await addReading(
      {
        cycle_id: openCycle.id!,
        meter_id: openCycle.meter_id,
        user_id: uid,
        prev_reading_tenths: fromTenths,
        curr_reading_tenths: toTenths,
        recorded_at: detectedAt || new Date().toISOString(),
        notes: '',
      },
      { mode: 'NONE' },
      'KEEP_AS_IS'
    );
    setAssigningInternalKey(null);
  };

  const handleReopen = async (cycleId: number) => {
    setReopenError('');
    if (
      !window.confirm(
        'هل تريد إعادة فتح هذه الدورة للتعديل؟ سيتم استرجاع القراءات الأصلية قبل الإزاحة.'
      )
    ) {
      return;
    }
    try {
      await reopenCycle(cycleId);
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : 'تعذر إعادة فتح الدورة');
    }
  };

  const totalConsumption = readings.reduce((s, r) => s + r.consumption_tenths, 0);

  const handleResolveGap = async (gapId: number) => {
    const uid = assignUserId || users[0]?.id;
    if (!uid) return;
    await resolvePendingGapToUser(gapId, uid);
    setAssigningGapId(null);
  };

  return (
    <div className="space-y-5">
      {/* Active Cycle */}
      {openCycle ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                الدورة النشطة
              </span>
              <div className="mt-1 flex items-center gap-1.5">
                <h2 className="text-base font-bold text-slate-900">
                  {openCycle.title}
                </h2>
                <button
                  type="button"
                  aria-label="تعديل اسم الدورة"
                  onClick={() => openEditTitle(openCycle)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-teal-700"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs text-slate-500">
                بدأت في {formatDateAr(openCycle.start_date)} • سعر الكيلو:{' '}
                {formatCurrency(openCycle.kwh_price_agorot)} {settings.currency_symbol}
              </p>
            </div>
            <div className="text-left">
              <p className="text-xs text-slate-500">السحب المسجل</p>
              <p className="text-base font-bold tabular-nums text-teal-700">
                {formatKwh(totalConsumption)} ك.و
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onStartClosingWizard}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            <Lock className="h-4 w-4" />
            <span>إقفال الدورة ومطابقة الفاتورة</span>
          </button>

          <button
            type="button"
            onClick={() => setShowScanResults((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 text-xs font-bold text-teal-900 transition hover:bg-teal-100"
          >
            <SearchCheck className="h-4 w-4" />
            <span>
              فحص قراءات الدورة (الفجوات والاختلافات: {internalAndOverlapItems.length})
            </span>
          </button>

          {showScanResults && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              {internalAndOverlapItems.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>لا توجد فجوات غير مسجلة أو تداخلات بين قراءات المستخدمين.</span>
                </div>
              ) : (
                internalAndOverlapItems.map((item) => {
                  const prevU = item.prevUserId
                    ? users.find((u) => u.id === item.prevUserId)?.name
                    : undefined;
                  const nextU = item.nextUserId
                    ? users.find((u) => u.id === item.nextUserId)?.name
                    : undefined;

                  if (item.kind === 'OVERLAP') {
                    return (
                      <div
                        key={item.key}
                        className="space-y-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"
                      >
                        <div>
                          <p className="font-bold tabular-nums">
                            تداخل في القراءات: {formatKwh(item.amountTenths)} ك.و (
                            {formatKwh(item.fromTenths)} ← {formatKwh(item.toTenths)})
                          </p>
                          {(prevU || nextU) && (
                            <p className="mt-0.5 text-[11px] text-rose-700">
                              بين <strong>{prevU ?? 'السابق'}</strong> و{' '}
                              <strong>{nextU ?? 'التالي'}</strong>
                            </p>
                          )}
                        </div>

                        {item.prevReadingId && item.nextReadingId && (
                          <div className="grid grid-cols-2 gap-2 border-t border-rose-200 pt-2">
                            <button
                              type="button"
                              onClick={() =>
                                resolveOverlapBetweenReadings({
                                  prevReadingId: item.prevReadingId!,
                                  nextReadingId: item.nextReadingId!,
                                  overlapTenths: item.amountTenths,
                                  keepSide: 'KEEP_PREV',
                                })
                              }
                              className="min-h-[44px] rounded-xl bg-rose-700 px-2.5 text-xs font-bold text-white hover:bg-rose-800"
                            >
                              إسناد لـ {prevU ?? 'القبل'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                resolveOverlapBetweenReadings({
                                  prevReadingId: item.prevReadingId!,
                                  nextReadingId: item.nextReadingId!,
                                  overlapTenths: item.amountTenths,
                                  keepSide: 'KEEP_NEXT',
                                })
                              }
                              className="min-h-[44px] rounded-xl border border-rose-300 bg-white px-2.5 text-xs font-bold text-rose-900 hover:bg-rose-100"
                            >
                              إسناد لـ {nextU ?? 'البعد'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.key}
                      className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="inline-block rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
                            فجوة غير مسجلة بين القراءات
                          </span>
                          <p className="mt-1 font-bold tabular-nums text-amber-950">
                            {formatKwh(item.amountTenths)} ك.و ({formatKwh(item.fromTenths)}{' '}
                            ← {formatKwh(item.toTenths)})
                          </p>
                          {(prevU || nextU) && (
                            <p className="text-[11px] text-amber-800">
                              {prevU ? `بعد: ${prevU}` : ''}
                              {prevU && nextU ? ' • ' : ''}
                              {nextU ? `قبل: ${nextU}` : ''}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAssigningInternalKey(
                              assigningInternalKey === item.key ? null : item.key
                            )
                          }
                          className="min-h-[44px] rounded-xl bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"
                        >
                          إسناد لمستخدم
                        </button>
                      </div>

                      {assigningInternalKey === item.key && users.length > 0 && (
                        <div className="flex gap-2 border-t border-amber-200 pt-2">
                          <select
                            value={assignUserId || users[0].id}
                            onChange={(e) => setAssignUserId(Number(e.target.value))}
                            className="min-h-[44px] flex-1 rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold text-slate-900"
                          >
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              handleAssignInternalGap(
                                item.fromTenths,
                                item.toTenths,
                                item.detectedAt
                              )
                            }
                            className="flex min-h-[44px] items-center gap-1 rounded-xl bg-teal-700 px-4 text-xs font-bold text-white"
                          >
                            <UserCheck className="h-4 w-4" />
                            <span>تأكيد</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center space-y-3">
          <p className="text-sm font-bold text-slate-700">
            لا توجد دورة مفتوحة حالياً
          </p>
          <button
            type="button"
            onClick={onOpenCycleClick}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white hover:bg-teal-800"
          >
            <Plus className="h-4 w-4" />
            <span>فتح دورة جديدة</span>
          </button>
        </div>
      )}

      {/* Pending Gaps */}
      {openCycle && (
        <div className="space-y-2.5">
          <h3 className="text-sm font-bold text-slate-800">
            الفجوات المعلقة ({pendingGaps.length})
          </h3>
          {pendingGaps.length === 0 ? (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>لا توجد فجوات معلقة في الدورة الحالية.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingGaps.map((g) => (
                <div
                  key={g.id}
                  className="space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <div>
                        <p className="text-sm font-bold tabular-nums text-amber-950">
                          فجوة {formatKwh(g.gap_tenths)} ك.و ({formatKwh(g.from_reading_tenths)}{' '}
                          ← {formatKwh(g.to_reading_tenths)})
                        </p>
                        <p className="text-[11px] text-amber-800">
                          اكتُشفت في {formatDateTimeAr(g.detected_at)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAssigningGapId(assigningGapId === g.id ? null : g.id!)
                      }
                      className="min-h-[44px] rounded-xl bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"
                    >
                      إسناد لمستخدم
                    </button>
                  </div>

                  {assigningGapId === g.id && users.length > 0 && (
                    <div className="flex gap-2 border-t border-amber-200 pt-2.5">
                      <select
                        value={assignUserId || users[0].id}
                        onChange={(e) => setAssignUserId(Number(e.target.value))}
                        className="min-h-[44px] flex-1 rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold text-slate-900"
                      >
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleResolveGap(g.id!)}
                        className="flex min-h-[44px] items-center gap-1 rounded-xl bg-teal-700 px-4 text-xs font-bold text-white"
                      >
                        <UserCheck className="h-4 w-4" />
                        <span>تأكيد</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Closed Cycles Archive */}
      <div className="space-y-2.5">
        <h3 className="text-sm font-bold text-slate-800">
          أرشيف الدورات المغلقة ({closedCycles.length})
        </h3>
        {reopenError && (
          <p className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">
            {reopenError}
          </p>
        )}
        {closedCycles.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-500">
            لا توجد دورات مغلقة بعد.
          </div>
        ) : (
          <div className="space-y-2">
            {closedCycles.map((c) => (
              <div
                key={c.id}
                className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-sm font-bold text-slate-900">{c.title}</h4>
                      <button
                        type="button"
                        aria-label="تعديل اسم الدورة"
                        onClick={() => openEditTitle(c)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-teal-700"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      {formatDateAr(c.start_date)} —{' '}
                      {c.end_date ? formatDateAr(c.end_date) : ''}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold tabular-nums text-teal-700">
                      {c.bill_kwh_tenths !== null
                        ? `${formatKwh(c.bill_kwh_tenths)} ك.و`
                        : '—'}
                    </p>
                    <p className="text-[11px] tabular-nums text-slate-500">
                      {c.bill_amount_agorot !== null
                        ? `${formatCurrency(c.bill_amount_agorot)} ${settings.currency_symbol}`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() => setFinalViewCycle(c)}
                    className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-teal-300 bg-teal-50 px-3 text-xs font-bold text-teal-900 hover:bg-teal-100"
                  >
                    <FileCheck2 className="h-4 w-4" />
                    <span>عرض النسخة النهائية</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuditCycleId(c.id!)}
                    className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"
                  >
                    <Eye className="h-4 w-4" />
                    <span>عرض النسخة الأولية</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReopen(c.id!)}
                    className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-900 hover:bg-amber-100"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span>إعادة فتح للتعديل</span>
                  </button>
                  {cyclesWithPendingShift.has(c.id!) && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          window.confirm(
                            'هل تريد إزاحة قراءات هذه الدورة المغلقة الآن لتتطابق مع الكميات المحوّلة؟'
                          )
                        ) {
                          try {
                            await applyPostCloseShift(c.id!);
                          } catch (err) {
                            setReopenError(
                              err instanceof Error ? err.message : 'تعذر إزاحة القراءات'
                            );
                          }
                        }
                      }}
                      className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-3 text-xs font-bold text-white hover:bg-teal-800"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                      <span>إزاحة القراءات الآن (تطبيق التحويل على القراءات)</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PreShiftAuditModal
        cycleId={auditCycleId}
        users={users}
        onClose={() => setAuditCycleId(null)}
      />

      <FinalCycleViewModal
        cycle={finalViewCycle}
        users={users}
        settings={settings}
        onClose={() => setFinalViewCycle(null)}
      />

      <Modal
        open={!!editingCycle}
        onClose={() => setEditingCycle(null)}
        title="تعديل اسم الدورة"
      >
        <form onSubmit={handleSaveCycleTitle} className="space-y-4">
          <input
            type="text"
            value={editTitleStr}
            onChange={(e) => setEditTitleStr(e.target.value)}
            placeholder="مثال: 14/11/2026 - 21/11/2026"
            className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-900"
            autoFocus
          />
          {editTitleErr && (
            <p className="rounded-xl bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
              {editTitleErr}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              className="min-h-[44px] flex-1 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800"
            >
              حفظ الاسم
            </button>
            <button
              type="button"
              onClick={() => setEditingCycle(null)}
              className="min-h-[44px] rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
