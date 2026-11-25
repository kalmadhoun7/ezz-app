import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ArrowRight, ArrowLeft, Lock } from 'lucide-react';
import { Modal } from '../common/Modal';
import { NumericInput } from '../common/NumericInput';
import {
  analyzeCycleDiscrepancies,
  analyzeOverflowReadings,
  computeCycleFinancialDiff,
  executeCloseCycle,
} from '../../db/closingEngine';
import { formatCurrency, formatKwh, toDateTimeLocalValue } from '../../utils/format';
import {
  agorotToKwhTenths,
  computeAmountAgorot,
  distributeProportionally,
  parseCurrencyToAgorot,
  parseKwhToTenths,
} from '../../utils/math';
import type { Cycle, PendingGap, Reading, Settings, User } from '../../types/models';

interface ClosingWizardModalProps {
  open: boolean;
  onClose: () => void;
  cycle: Cycle;
  readings: Reading[];
  pendingGaps: PendingGap[];
  users: User[];
  settings: Settings;
  onClosed: () => void;
}

export const ClosingWizardModal: React.FC<ClosingWizardModalProps> = ({
  open,
  onClose,
  cycle,
  readings,
  pendingGaps,
  users,
  settings,
  onClosed,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 state
  const lastMainCurr =
    readings.length > 0
      ? Math.max(
          cycle.opening_reading_tenths,
          ...readings.map((r) => r.curr_reading_tenths)
        )
      : cycle.opening_reading_tenths;

  const [billPrevStr, setBillPrevStr] = useState(() =>
    formatKwh(cycle.opening_reading_tenths)
  );
  const [billCurrStr, setBillCurrStr] = useState(() => formatKwh(lastMainCurr));
  const [billAmountStr, setBillAmountStr] = useState(() =>
    formatCurrency(
      computeAmountAgorot(
        Math.max(0, lastMainCurr - cycle.opening_reading_tenths),
        cycle.kwh_price_agorot
      )
    )
  );
  const [billAmountManual, setBillAmountManual] = useState(false);
  const [discountKwhStr, setDiscountKwhStr] = useState('0.0');
  const [endDateStr, setEndDateStr] = useState(() => toDateTimeLocalValue());

  // Re-initialize Step 1 values whenever the modal opens so it always reflects the latest readings
  useEffect(() => {
    if (open) {
      setStep(1);
      setStep2Phase('AUDIT');
      setBillPrevStr(formatKwh(cycle.opening_reading_tenths));
      setBillCurrStr(formatKwh(lastMainCurr));
      setBillAmountStr(
        formatCurrency(
          computeAmountAgorot(
            Math.max(0, lastMainCurr - cycle.opening_reading_tenths),
            cycle.kwh_price_agorot
          )
        )
      );
      setDiscountKwhStr('0.0');
      setBillAmountManual(false);
      setUserLossAllocations({});
      setUserLossStrs({});
      setUserDiscountKwh({});
      setUserDiscountStrs({});
      setUserSurchargesAgorot({});
      setUserSurchargeStrs({});
      setEndDateStr(toDateTimeLocalValue());
      setError('');
    }
  }, [open, cycle.id]);

  // Step 2 state
  const [step2Phase, setStep2Phase] = useState<'AUDIT' | 'DISTRIBUTE'>('AUDIT');
  const [gapAssignments, setGapAssignments] = useState<Record<number, number>>({});
  const [slotGapAssignments, setSlotGapAssignments] = useState<Record<string, number>>({});
  const [selectedLossUsers, setSelectedLossUsers] = useState<number[]>([]);
  const [userLossAllocations, setUserLossAllocations] = useState<Record<number, number>>({});
  const [userLossStrs, setUserLossStrs] = useState<Record<number, string>>({});
  const [keepUnallocated, setKeepUnallocated] = useState(false);

  // Step 4 state
  const [userDiscountKwh, setUserDiscountKwh] = useState<Record<number, number>>({});
  const [userDiscountStrs, setUserDiscountStrs] = useState<Record<number, string>>({});
  const [surchargeMode, setSurchargeMode] = useState<
    'RECALCULATE_RATE' | 'DISTRIBUTE_SURCHARGE'
  >('RECALCULATE_RATE');
  const [userSurchargesAgorot, setUserSurchargesAgorot] = useState<Record<number, number>>({});
  const [userSurchargeStrs, setUserSurchargeStrs] = useState<Record<number, string>>({});

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const billPrevTenths = parseKwhToTenths(billPrevStr) ?? 0;
  const billCurrTenths = parseKwhToTenths(billCurrStr) ?? 0;
  const billKwhTenths = Math.max(0, billCurrTenths - billPrevTenths);
  const billAmountAgorot = parseCurrencyToAgorot(billAmountStr) ?? 0;

  const overflow = useMemo(
    () =>
      analyzeOverflowReadings(
        readings,
        cycle.opening_reading_tenths,
        billCurrTenths
      ),
    [readings, cycle.opening_reading_tenths, billCurrTenths]
  );

  const discrepancyReport = useMemo(
    () =>
      analyzeCycleDiscrepancies(
        overflow.inCycleReadings,
        overflow.straddling,
        pendingGaps,
        billPrevTenths,
        billCurrTenths
      ),
    [overflow, pendingGaps, billPrevTenths, billCurrTenths]
  );

  // Total loss = billKwh - inCycleConsumption
  const totalLossTenths = discrepancyReport.netLossTenths;

  const assignedGapsTenths = discrepancyReport.items.reduce((s, item) => {
    if (item.kind === 'OVERLAP') return s;
    if (item.pendingGapId && gapAssignments[item.pendingGapId]) {
      return s + item.amountTenths;
    }
    if (!item.pendingGapId && slotGapAssignments[item.key]) {
      return s + item.amountTenths;
    }
    return s;
  }, 0);

  const distributedUserLossTenths = Object.values(userLossAllocations).reduce(
    (s, v) => s + (v || 0),
    0
  );
  const remainingLossToAllocateTenths =
    totalLossTenths - assignedGapsTenths - distributedUserLossTenths;

  // Projected user kWh consumption after Step 2 (used in Step 4 for discount caps)
  const projectedUserKwh = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of overflow.inCycleReadings) {
      map.set(r.user_id, (map.get(r.user_id) ?? 0) + r.consumption_tenths);
    }
    for (const r of overflow.straddling) {
      const part1 = Math.max(0, billCurrTenths - r.prev_reading_tenths);
      map.set(r.user_id, (map.get(r.user_id) ?? 0) + part1);
    }
    for (const item of discrepancyReport.items) {
      if (item.kind === 'OVERLAP') continue;
      const uid = item.pendingGapId
        ? gapAssignments[item.pendingGapId]
        : slotGapAssignments[item.key];
      if (uid) map.set(uid, (map.get(uid) ?? 0) + item.amountTenths);
    }
    for (const [uidStr, tenths] of Object.entries(userLossAllocations)) {
      const uid = Number(uidStr);
      if (tenths > 0) map.set(uid, (map.get(uid) ?? 0) + tenths);
    }
    return map;
  }, [overflow, billCurrTenths, discrepancyReport, gapAssignments, slotGapAssignments, userLossAllocations]);

  const financialDiff = useMemo(
    () =>
      computeCycleFinancialDiff(
        billKwhTenths,
        billAmountAgorot,
        cycle.kwh_price_agorot
      ),
    [billKwhTenths, billAmountAgorot, cycle.kwh_price_agorot]
  );

  const allocatedDiscountTenths = Object.values(userDiscountKwh).reduce(
    (s, v) => s + (v || 0),
    0
  );
  const remainingDiscountTenths =
    financialDiff.discountKwhTenths - allocatedDiscountTenths;

  const allocatedSurchargeAgorot = Object.values(userSurchargesAgorot).reduce(
    (s, v) => s + (v || 0),
    0
  );
  const remainingSurchargeAgorot =
    financialDiff.surchargeAgorot - allocatedSurchargeAgorot;

  const handleAutoDistributeLoss = () => {
    const target = totalLossTenths - assignedGapsTenths;
    if (target <= 0 || selectedLossUsers.length === 0) return;

    const items = selectedLossUsers.map((uid) => {
      let weight = 0;
      for (const r of overflow.inCycleReadings) {
        if (r.user_id === uid) weight += r.consumption_tenths;
      }
      return { id: uid, weight };
    });

    const shares = distributeProportionally(target, items);
    const next: Record<number, number> = {};
    const nextStrs: Record<number, string> = {};
    shares.forEach((val, uid) => {
      next[uid] = val;
      nextStrs[uid] = val ? formatKwh(val) : '';
    });
    setUserLossAllocations(next);
    setUserLossStrs(nextStrs);
  };

  const handleAutoDistributeSurcharge = () => {
    const items = Array.from(projectedUserKwh.entries()).map(([uid, kwh]) => ({
      id: uid,
      weight: kwh,
    }));
    const shares = distributeProportionally(financialDiff.surchargeAgorot, items);
    const next: Record<number, number> = {};
    const nextStrs: Record<number, string> = {};
    shares.forEach((val, uid) => {
      next[uid] = val;
      nextStrs[uid] = val ? formatCurrency(val) : '';
    });
    setUserSurchargesAgorot(next);
    setUserSurchargeStrs(nextStrs);
  };

  const validateStep1 = () => {
    setError('');
    if (billCurrTenths < billPrevTenths) {
      setError('القراءة الحالية في الفاتورة لا يمكن أن تكون أقل من القراءة السابقة');
      return false;
    }
    if (!billAmountStr || billAmountAgorot < 0) {
      setError('يرجى إدخال مبلغ فاتورة الموزع');
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    setError('');
    if (remainingLossToAllocateTenths < 0) {
      setError('تجاوزت كمية الفاقد الموزعة إجمالي الفاقد المطلوب');
      return false;
    }
    if (remainingLossToAllocateTenths > 0 && !keepUnallocated) {
      setError(
        'يجب توزيع كامل الفاقد (المتبقي 0.0) أو تفعيل خيار إبقاء المتبقي كفقد مستقل'
      );
      return false;
    }
    return true;
  };

  const handleConfirmClose = async () => {
    setError('');
    if (financialDiff.discountKwhTenths > 0 && remainingDiscountTenths !== 0) {
      setError('يجب توزيع كامل قيمة الخصم حتى يصل المتبقي إلى 0.0 ك.و');
      return;
    }
    if (
      financialDiff.surchargeAgorot > 0 &&
      surchargeMode === 'DISTRIBUTE_SURCHARGE' &&
      remainingSurchargeAgorot !== 0
    ) {
      setError('يجب توزيع كامل مبلغ الزيادة حتى يصل المتبقي إلى 0.00');
      return;
    }

    const slotGaps = discrepancyReport.items
      .filter((item) => !item.pendingGapId && item.kind !== 'OVERLAP' && slotGapAssignments[item.key])
      .map((item) => ({
        fromTenths: item.fromTenths,
        toTenths: item.toTenths,
        userId: slotGapAssignments[item.key],
        detectedAt: item.detectedAt,
      }));

    setSubmitting(true);
    try {
      await executeCloseCycle({
        cycleId: cycle.id!,
        billPrevTenths,
        billCurrTenths,
        billKwhTenths,
        billAmountAgorot,
        endDate: new Date(endDateStr).toISOString(),
        gapAssignments,
        slotGapAssignments: slotGaps,
        userLossAllocations,
        unallocatedLossTenths: keepUnallocated
          ? Math.max(0, remainingLossToAllocateTenths)
          : 0,
        userDiscountKwh,
        surchargeMode:
          financialDiff.surchargeAgorot > 0 ? surchargeMode : 'NONE',
        userSurchargesAgorot:
          financialDiff.surchargeAgorot > 0 &&
          surchargeMode === 'DISTRIBUTE_SURCHARGE'
            ? userSurchargesAgorot
            : undefined,
      });
      onClosed();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء إقفال الدورة');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`معالج إقفال الدورة — خطوة ${step} من 4`}
      maxWidthClass="max-w-xl"
    >
      <div className="space-y-4">
        {/* Progress Bar */}
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full ${
                s <= step ? 'bg-teal-700' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        {/* STEP 1: BILL & OVERFLOW */}
        {step === 1 && (
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-900">
              1. بيانات فاتورة موزع الكهرباء وفحص القراءات المتأخرة
            </h4>

            <div className="grid grid-cols-2 gap-3">
              <NumericInput
                label="القراءة السابقة بالفاتورة"
                value={billPrevStr}
                onChange={(val) => {
                  setBillPrevStr(val);
                  if (!billAmountManual) {
                    const p = parseKwhToTenths(val) ?? 0;
                    const c = parseKwhToTenths(billCurrStr) ?? 0;
                    setBillAmountStr(
                      formatCurrency(
                        computeAmountAgorot(Math.max(0, c - p), cycle.kwh_price_agorot)
                      )
                    );
                  }
                }}
                suffix="ك.و"
              />
              <NumericInput
                label="القراءة الحالية بالفاتورة"
                value={billCurrStr}
                onChange={(val) => {
                  setBillCurrStr(val);
                  if (!billAmountManual) {
                    const p = parseKwhToTenths(billPrevStr) ?? 0;
                    const c = parseKwhToTenths(val) ?? 0;
                    setBillAmountStr(
                      formatCurrency(
                        computeAmountAgorot(Math.max(0, c - p), cycle.kwh_price_agorot)
                      )
                    );
                  }
                }}
                suffix="ك.و"
              />
            </div>

            {billPrevTenths !== cycle.opening_reading_tenths && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                تنبيه: القراءة السابقة في الفاتورة ({formatKwh(billPrevTenths)}) تختلف عن
                افتتاحية الدورة ({formatKwh(cycle.opening_reading_tenths)}).
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold text-slate-500">
                  إجمالي سحب الفاتورة
                </p>
                <p className="mt-0.5 text-base font-bold tabular-nums text-teal-800">
                  {formatKwh(billKwhTenths)} ك.و
                </p>
                <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                  المبلغ المتوقع: {formatCurrency(financialDiff.expectedAmountAgorot)}{' '}
                  {settings.currency_symbol}
                </p>
              </div>
              <div className="space-y-2">
                <NumericInput
                  label={`مبلغ الفاتورة (${settings.currency_symbol})`}
                  value={billAmountStr}
                  onChange={(val) => {
                    setBillAmountManual(true);
                    setBillAmountStr(val);
                    const ag = parseCurrencyToAgorot(val) ?? 0;
                    const expected = computeAmountAgorot(
                      billKwhTenths,
                      cycle.kwh_price_agorot
                    );
                    if (ag < expected) {
                      setDiscountKwhStr(
                        formatKwh(
                          agorotToKwhTenths(expected - ag, cycle.kwh_price_agorot)
                        )
                      );
                    } else {
                      setDiscountKwhStr('0.0');
                    }
                  }}
                  maxDecimals={2}
                  placeholder="0.00"
                />
                <NumericInput
                  label="خصم بالكيلو واط (ك.و)"
                  value={discountKwhStr}
                  onChange={(val) => {
                    setBillAmountManual(true);
                    setDiscountKwhStr(val);
                    const discTenths = Math.min(
                      billKwhTenths,
                      parseKwhToTenths(val) ?? 0
                    );
                    const netKwh = Math.max(0, billKwhTenths - discTenths);
                    setBillAmountStr(
                      formatCurrency(
                        computeAmountAgorot(netKwh, cycle.kwh_price_agorot)
                      )
                    );
                  }}
                  suffix="ك.و"
                  placeholder="0.0"
                />
                {billAmountStr !== '' && financialDiff.discountKwhTenths > 0 && (
                  <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 tabular-nums">
                    قيمة الخصم: {formatCurrency(financialDiff.diffAgorot)}{' '}
                    {settings.currency_symbol} (يعادل{' '}
                    {formatKwh(financialDiff.discountKwhTenths)} ك.و)
                  </p>
                )}
                {billAmountStr !== '' && financialDiff.surchargeAgorot > 0 && (
                  <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900 tabular-nums">
                    زيادة عن المتوقع: +{formatCurrency(financialDiff.surchargeAgorot)}{' '}
                    {settings.currency_symbol}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                تاريخ ووقت الإقفال
              </label>
              <input
                type="datetime-local"
                value={endDateStr}
                onChange={(e) => setEndDateStr(e.target.value)}
                className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold"
              />
            </div>

            {(overflow.straddling.length > 0 || overflow.fullyAfter.length > 0) && (
              <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950">
                <p className="font-bold">
                  تم اكتشاف قراءات تتجاوز قراءة الفاتورة ({formatKwh(billCurrTenths)}):
                </p>
                {overflow.straddling.map((r) => (
                  <p key={r.id}>
                    • قراءة متقاطعة ({formatKwh(r.prev_reading_tenths)} ←{' '}
                    {formatKwh(r.curr_reading_tenths)}): ستُقسم تلقائياً عند{' '}
                    {formatKwh(billCurrTenths)} ويُرحّل الباقي للدورة الجديدة.
                  </p>
                ))}
                {overflow.fullyAfter.map((r) => (
                  <p key={r.id}>
                    • قراءة لاحقة بالكامل ({formatKwh(r.prev_reading_tenths)} ←{' '}
                    {formatKwh(r.curr_reading_tenths)}): ستُرحّل بالكامل للدورة الجديدة.
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: AUDIT FIRST -> THEN LOSS ALLOCATION */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">
                {step2Phase === 'AUDIT'
                  ? '2أ. فحص الفجوات والاختلافات بين المستخدمين'
                  : '2ب. توزيع الفاقد المتبقي على المستخدمين'}
              </h4>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold tabular-nums ${
                  remainingLossToAllocateTenths === 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                المتبقي للتوزيع: {formatKwh(remainingLossToAllocateTenths)} ك.و
              </span>
            </div>

            {step2Phase === 'AUDIT' && (
              <>
                {/* Transparent equation breakdown */}
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs">
                  <div>
                    <p className="text-slate-500">سحب الفاتورة</p>
                    <p className="mt-0.5 font-bold tabular-nums text-slate-900">
                      {formatKwh(discrepancyReport.billKwhTenths)} ك.و
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">مجموع القراءات</p>
                    <p className="mt-0.5 font-bold tabular-nums text-teal-800">
                      {formatKwh(discrepancyReport.recordedKwhTenths)} ك.و
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">إجمالي الفارق</p>
                    <p className="mt-0.5 font-bold tabular-nums text-amber-700">
                      {formatKwh(discrepancyReport.netLossTenths)} ك.و
                    </p>
                  </div>
                </div>

                {discrepancyReport.items.length === 0 && totalLossTenths === 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-800">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>تطابق تام! لا توجد أي فجوات أو تداخلات في هذه الدورة.</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-xs font-bold text-slate-700">
                      تفاصيل الفجوات والاختلافات المكتشفة (من ← إلى):
                    </p>
                    {discrepancyReport.items.map((item) => {
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
                            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"
                          >
                            <p className="font-bold tabular-nums">
                              تداخل بين المستخدمين: {formatKwh(item.amountTenths)} ك.و (
                              {formatKwh(item.fromTenths)} ← {formatKwh(item.toTenths)})
                            </p>
                            {(prevU || nextU) && (
                              <p className="mt-0.5 text-[11px] text-rose-700">
                                بين {prevU ?? '—'} و {nextU ?? '—'}
                              </p>
                            )}
                          </div>
                        );
                      }

                      const kindLabel =
                        item.kind === 'PENDING_GAP'
                          ? 'فجوة معلقة'
                          : item.kind === 'CLOSING_GAP'
                          ? 'فارق الإغلاق الختامي'
                          : 'فجوة بين القراءات';

                      const selectedUid = item.pendingGapId
                        ? gapAssignments[item.pendingGapId] ?? ''
                        : slotGapAssignments[item.key] ?? '';

                      return (
                        <div
                          key={item.key}
                          className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="text-xs">
                            <span className="inline-block rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
                              {kindLabel}
                            </span>
                            <p className="mt-1 font-bold tabular-nums text-amber-950">
                              {formatKwh(item.amountTenths)} ك.و (من{' '}
                              {formatKwh(item.fromTenths)} ← إلى{' '}
                              {formatKwh(item.toTenths)})
                            </p>
                            {(prevU || nextU) && (
                              <p className="text-[11px] text-amber-800">
                                {prevU ? `بعد: ${prevU}` : ''}
                                {prevU && nextU ? ' • ' : ''}
                                {nextU ? `قبل: ${nextU}` : ''}
                              </p>
                            )}
                          </div>

                          <select
                            value={selectedUid}
                            onChange={(e) => {
                              const val = e.target.value ? Number(e.target.value) : 0;
                              if (item.pendingGapId) {
                                setGapAssignments((prev) => ({
                                  ...prev,
                                  [item.pendingGapId!]: val,
                                }));
                              } else {
                                setSlotGapAssignments((prev) => ({
                                  ...prev,
                                  [item.key]: val,
                                }));
                              }
                            }}
                            className="min-h-[44px] rounded-xl border border-amber-300 bg-white px-2.5 text-xs font-semibold"
                          >
                            <option value="">تترك كفجوة (تُوزع لاحقاً)</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                إسناد لـ: {u.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {step2Phase === 'DISTRIBUTE' && (
              <>
                <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-800">
                      توزيع الفاقد المتبقي على مستخدمين مختارين:
                    </p>
                    <button
                      type="button"
                      onClick={handleAutoDistributeLoss}
                      disabled={selectedLossUsers.length === 0}
                      className="min-h-[44px] rounded-xl bg-teal-700 px-3 text-xs font-bold text-white disabled:opacity-40"
                    >
                      توزيع نسبي تلقائي
                    </button>
                  </div>

                  <div className="space-y-2">
                    {users.map((u) => {
                      const checked = selectedLossUsers.includes(u.id!);
                      const valTenths = userLossAllocations[u.id!] ?? 0;
                      return (
                        <div
                          key={u.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-white p-2"
                        >
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-800">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedLossUsers((p) => [...p, u.id!]);
                                } else {
                                  setSelectedLossUsers((p) =>
                                    p.filter((id) => id !== u.id)
                                  );
                                  setUserLossAllocations((p) => {
                                    const copy = { ...p };
                                    delete copy[u.id!];
                                    return copy;
                                  });
                                }
                              }}
                            />
                            <span>{u.name}</span>
                          </label>

                          <div className="w-28">
                            <NumericInput
                              value={
                                userLossStrs[u.id!] ??
                                (valTenths ? formatKwh(valTenths) : '')
                              }
                              placeholder="0.0"
                              onChange={(str) => {
                                setUserLossStrs((p) => ({ ...p, [u.id!]: str }));
                                const t = parseKwhToTenths(str) ?? 0;
                                setUserLossAllocations((p) => ({
                                  ...p,
                                  [u.id!]: t,
                                }));
                              }}
                              suffix="ك.و"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {remainingLossToAllocateTenths > 0 && (
                  <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={keepUnallocated}
                      onChange={(e) => setKeepUnallocated(e.target.checked)}
                    />
                    <span>
                      إبقاء المتبقي ({formatKwh(remainingLossToAllocateTenths)} ك.و) كبند
                      فقد دورة مستقل للمراجعة
                    </span>
                  </label>
                )}
              </>
            )}
          </div>
        )}

        {/* STEP 3: SILENT SNAPSHOT & SHIFTING PREVIEW */}
        {step === 3 && (
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-900">
              3. معاينة الدمج السلس والنسخة الأصلية الصامتة
            </h4>

            <div className="rounded-xl border border-teal-200 bg-teal-50 p-3.5 text-xs leading-relaxed text-teal-900">
              <p className="font-bold">سيتم تنفيذ الآتي تلقائياً عند الإقفال:</p>
              <ul className="mt-1.5 list-inside list-disc space-y-1">
                <li>
                  حفظ نسخة أصلية صامتة (<code>PRE_CLOSE_ORIGINAL</code>) للمدير فقط قبل
                  أي تعديل.
                </li>
                <li>
                  دمج الفاقد الموزع بسلاسة داخل قراءات المستخدمين دون ظهور كلمة "فاقد" في
                  أي فاتورة أو تقرير.
                </li>
                <li>
                  الحفاظ على كميات سحب المستخدمين غير المستهدفين ثابتة 100% مع إزاحة
                  القراءات المتسلسلة لتنتهي الدورة عند{' '}
                  <strong className="tabular-nums">{formatKwh(billCurrTenths)}</strong>.
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
              <p className="text-xs font-bold text-slate-700">
                ملخص الاستهلاك النهائي للمستخدمين في الدورة:
              </p>
              {Array.from(projectedUserKwh.entries()).map(([uid, kwh]) => {
                const u = users.find((x) => x.id === uid);
                return (
                  <div
                    key={uid}
                    className="flex items-center justify-between text-xs font-semibold"
                  >
                    <span>{u?.name ?? 'مستخدم'}</span>
                    <span className="tabular-nums text-teal-800">
                      {formatKwh(kwh)} ك.و
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 4: FINANCIAL RECONCILIATION */}
        {step === 4 && (
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-900">
              4. المطابقة المالية (الخصومات والزيادات)
            </h4>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <div>
                <p className="text-slate-500">المبلغ المتوقع (السحب × السعر)</p>
                <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">
                  {formatCurrency(financialDiff.expectedAmountAgorot)}{' '}
                  {settings.currency_symbol}
                </p>
              </div>
              <div>
                <p className="text-slate-500">مبلغ فاتورة الموزع</p>
                <p className="mt-0.5 text-sm font-bold tabular-nums text-teal-800">
                  {formatCurrency(billAmountAgorot)} {settings.currency_symbol}
                </p>
              </div>
            </div>

            {financialDiff.discountKwhTenths === 0 &&
              financialDiff.surchargeAgorot === 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-bold text-emerald-800">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>المبلغ متطابق تماماً مع التسعيرة. جاهز للإقفال!</span>
                </div>
              )}

            {/* DISCOUNT MODE */}
            {financialDiff.discountKwhTenths > 0 && (
              <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-emerald-900">
                      يوجد خصم بقيمة {formatCurrency(financialDiff.diffAgorot)}{' '}
                      {settings.currency_symbol} (يعادل{' '}
                      {formatKwh(financialDiff.discountKwhTenths)} ك.و)
                    </p>
                    <p className="text-[11px] text-emerald-800">
                      الخصم يخفض المبلغ المستحق فقط ولا يغير كمية السحب المعروضة.
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
                      remainingDiscountTenths === 0
                        ? 'bg-emerald-600 text-white'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    المتبقي: {formatKwh(remainingDiscountTenths)} ك.و
                  </span>
                </div>

                <div className="space-y-2">
                  {Array.from(projectedUserKwh.entries()).map(([uid, maxKwh]) => {
                    const u = users.find((x) => x.id === uid);
                    const discVal = userDiscountKwh[uid] ?? 0;
                    return (
                      <div
                        key={uid}
                        className="flex items-center justify-between gap-2 rounded-xl bg-white p-2.5"
                      >
                        <div className="text-xs">
                          <p className="font-bold text-slate-900">{u?.name}</p>
                          <p className="text-[11px] text-slate-500">
                            السحب: {formatKwh(maxKwh)} ك.و
                          </p>
                        </div>
                        <div className="w-32">
                          <NumericInput
                            value={
                              userDiscountStrs[uid] ??
                              (discVal ? formatKwh(discVal) : '')
                            }
                            placeholder="0.0"
                            onChange={(str) => {
                              const parsed = parseKwhToTenths(str) ?? 0;
                              if (parsed > maxKwh) {
                                setUserDiscountStrs((p) => ({
                                  ...p,
                                  [uid]: formatKwh(maxKwh),
                                }));
                                setUserDiscountKwh((p) => ({ ...p, [uid]: maxKwh }));
                              } else {
                                setUserDiscountStrs((p) => ({ ...p, [uid]: str }));
                                setUserDiscountKwh((p) => ({ ...p, [uid]: parsed }));
                              }
                            }}
                            suffix="ك.و"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SURCHARGE MODE */}
            {financialDiff.surchargeAgorot > 0 && (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2 text-xs font-bold text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    تنبيه: الفاتورة أعلى من المتوقع بمقدار{' '}
                    {formatCurrency(financialDiff.surchargeAgorot)}{' '}
                    {settings.currency_symbol}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSurchargeMode('RECALCULATE_RATE')}
                    className={`min-h-[44px] rounded-xl border px-2 text-xs font-bold ${
                      surchargeMode === 'RECALCULATE_RATE'
                        ? 'border-teal-700 bg-teal-700 text-white'
                        : 'border-amber-300 bg-white text-amber-950'
                    }`}
                  >
                    إعادة حساب سعر الكيلو للدورة
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSurchargeMode('DISTRIBUTE_SURCHARGE');
                      handleAutoDistributeSurcharge();
                    }}
                    className={`min-h-[44px] rounded-xl border px-2 text-xs font-bold ${
                      surchargeMode === 'DISTRIBUTE_SURCHARGE'
                        ? 'border-teal-700 bg-teal-700 text-white'
                        : 'border-amber-300 bg-white text-amber-950'
                    }`}
                  >
                    توزيع الفارق المالي على المستخدمين
                  </button>
                </div>

                {surchargeMode === 'DISTRIBUTE_SURCHARGE' && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-amber-900">
                      المتبقي للتوزيع: {formatCurrency(remainingSurchargeAgorot)}{' '}
                      {settings.currency_symbol}
                    </p>
                    {Array.from(projectedUserKwh.keys()).map((uid) => {
                      const u = users.find((x) => x.id === uid);
                      const val = userSurchargesAgorot[uid] ?? 0;
                      return (
                        <div
                          key={uid}
                          className="flex items-center justify-between gap-2 rounded-xl bg-white p-2"
                        >
                          <span className="text-xs font-bold">{u?.name}</span>
                          <div className="w-32">
                            <NumericInput
                              maxDecimals={2}
                              value={
                                userSurchargeStrs[uid] ??
                                (val ? formatCurrency(val) : '')
                              }
                              placeholder="0.00"
                              onChange={(str) => {
                                setUserSurchargeStrs((p) => ({ ...p, [uid]: str }));
                                const ag = parseCurrencyToAgorot(str) ?? 0;
                                setUserSurchargesAgorot((p) => ({
                                  ...p,
                                  [uid]: ag,
                                }));
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">
            {error}
          </p>
        )}

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => {
                setError('');
                if (step === 2 && step2Phase === 'DISTRIBUTE') {
                  setStep2Phase('AUDIT');
                } else {
                  setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
                }
              }}
              className="flex min-h-[44px] items-center gap-1 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700"
            >
              <ArrowRight className="h-4 w-4" />
              <span>السابق</span>
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && !validateStep1()) return;
                if (step === 2 && step2Phase === 'AUDIT') {
                  setError('');
                  if (totalLossTenths - assignedGapsTenths > 0) {
                    setStep2Phase('DISTRIBUTE');
                  } else {
                    setStep(3);
                  }
                  return;
                }
                if (step === 2 && !validateStep2()) return;
                setError('');
                setStep((s) => (s + 1) as 1 | 2 | 3 | 4);
              }}
              className="flex min-h-[44px] items-center gap-1 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white hover:bg-teal-800"
            >
              <span>
                {step === 2 && step2Phase === 'AUDIT' && totalLossTenths - assignedGapsTenths > 0
                  ? 'توزيع الفاقد المتبقي'
                  : 'التالي'}
              </span>
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmClose}
              className="flex min-h-[48px] items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Lock className="h-4 w-4" />
              <span>{submitting ? 'جارٍ الإقفال...' : 'تأكيد وإقفال الدورة'}</span>
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
