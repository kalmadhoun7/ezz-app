import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Gauge, AlertCircle } from 'lucide-react';
import { NumericInput } from '../common/NumericInput';
import { GapDetectionModal } from './GapDetectionModal';
import { OverlapDetectionModal } from './OverlapDetectionModal';
import { formatCurrency, formatKwh, toDateTimeLocalValue } from '../../utils/format';
import { computeAmountAgorot, parseKwhToTenths } from '../../utils/math';
import { getLastReadingForMeter } from '../../db/cycleService';
import {
  addReading,
  detectMainMeterGap,
  detectMainMeterOverlap,
  type OverlapCandidate,
  type OverlapResolution,
} from '../../db/readingService';
import type { Cycle, Meter, Settings, User } from '../../types/models';

interface AddReadingTabProps {
  activeMainMeter: Meter | undefined;
  subMeters: Meter[];
  openCycle: Cycle | undefined;
  users: User[];
  settings: Settings;
  preselectedUserId?: number | null;
  onReadingSaved: () => void;
  onGoToCycles: () => void;
  onGoToSettings: () => void;
}

export const AddReadingTab: React.FC<AddReadingTabProps> = ({
  activeMainMeter,
  subMeters,
  openCycle,
  users,
  settings,
  preselectedUserId,
  onReadingSaved,
  onGoToCycles,
  onGoToSettings,
}) => {
  const [meterMode, setMeterMode] = useState<'MAIN' | 'SUB'>('MAIN');
  const [selectedSubMeterId, setSelectedSubMeterId] = useState<number>(0);
  const [selectedUserId, setSelectedUserId] = useState<number>(
    preselectedUserId ?? 0
  );
  const [prevStr, setPrevStr] = useState('');
  const [currStr, setCurrStr] = useState('');
  const [recordedAt, setRecordedAt] = useState(() => toDateTimeLocalValue());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const [gapPrompt, setGapPrompt] = useState<{
    lastRecordedTenths: number;
    enteredPrevTenths: number;
    gapTenths: number;
  } | null>(null);

  const [overlapPrompt, setOverlapPrompt] = useState<{
    overlappingReadings: OverlapCandidate[];
    enteredPrevTenths: number;
    enteredCurrTenths: number;
    deltaTenths: number;
    affectedCount: number;
    nextCandidate?: OverlapCandidate;
    prevCandidate?: OverlapCandidate;
  } | null>(null);

  const [anomalyConfirm, setAnomalyConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedUserId) {
      setSelectedUserId(preselectedUserId);
    }
  }, [preselectedUserId]);

  // Sync default sub-meter and default user when switching mode or sub-meter
  useEffect(() => {
    if (meterMode === 'SUB' && subMeters.length > 0) {
      const sub =
        subMeters.find((s) => s.id === selectedSubMeterId) ?? subMeters[0];
      if (sub.id !== selectedSubMeterId) {
        setSelectedSubMeterId(sub.id!);
      }
      if (sub.default_user_id) {
        setSelectedUserId(sub.default_user_id);
      } else if (users.length > 0 && !selectedUserId) {
        setSelectedUserId(users[0].id!);
      }
    } else if (users.length > 0 && !selectedUserId) {
      setSelectedUserId(users[0].id!);
    }
  }, [meterMode, subMeters, selectedSubMeterId, users]);

  // Auto-fill previous & current reading for selected meter with last recorded reading
  const targetMeterId =
    meterMode === 'MAIN' ? activeMainMeter?.id : selectedSubMeterId;

  useEffect(() => {
    let cancelled = false;
    if (!targetMeterId || !openCycle?.id) {
      setPrevStr('');
      setCurrStr('');
      return;
    }
    getLastReadingForMeter(targetMeterId, openCycle.id).then((lastTenths) => {
      if (!cancelled) {
        const formatted = formatKwh(lastTenths);
        setPrevStr(formatted);
        setCurrStr(formatted);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [targetMeterId, openCycle?.id, successMsg]);

  const adjustFieldByTenth = (
    currentStr: string,
    setter: (val: string) => void,
    deltaTenths: number
  ) => {
    const current = parseKwhToTenths(currentStr) ?? 0;
    const next = Math.max(0, current + deltaTenths);
    setter(formatKwh(next));
  };

  const preview = useMemo(() => {
    const prev = parseKwhToTenths(prevStr);
    const curr = parseKwhToTenths(currStr);
    if (prev === null || curr === null || curr <= prev || !openCycle) {
      return null;
    }
    const delta = curr - prev;
    const costAgorot = computeAmountAgorot(delta, openCycle.kwh_price_agorot);
    return { delta, costAgorot };
  }, [prevStr, currStr, openCycle]);

  if (!activeMainMeter) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm font-semibold text-slate-700">
          لا يوجد عداد رئيسي نشط.
        </p>
      </div>
    );
  }

  if (!openCycle) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
        <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
        <p className="text-sm font-bold text-amber-900">
          لا توجد دورة مفتوحة حالياً للعداد "{activeMainMeter.name}"
        </p>
        <p className="text-xs text-amber-800">
          يجب فتح دورة جديدة أولاً قبل تسجيل القراءات.
        </p>
        <button
          type="button"
          onClick={onGoToCycles}
          className="min-h-[44px] rounded-xl bg-teal-700 px-5 text-sm font-bold text-white hover:bg-teal-800"
        >
          الانتقال لفتح دورة جديدة
        </button>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
        <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
        <p className="text-sm font-bold text-amber-900">
          لا يوجد مستخدمون مسجلون بعد
        </p>
        <p className="text-xs text-amber-800">
          أضف المستخدمين أولاً من تبويب الإعدادات والمستخدمين.
        </p>
        <button
          type="button"
          onClick={onGoToSettings}
          className="min-h-[44px] rounded-xl bg-teal-700 px-5 text-sm font-bold text-white hover:bg-teal-800"
        >
          إضافة مستخدمين
        </button>
      </div>
    );
  }

  const executeSave = async (
    gapResolution:
      | { mode: 'NONE' }
      | { mode: 'PENDING_GAP' }
      | { mode: 'ASSIGN_TO_USER'; gap_user_id: number },
    overlapResolution: OverlapResolution = 'NONE'
  ) => {
    const prevTenths = parseKwhToTenths(prevStr)!;
    const currTenths = parseKwhToTenths(currStr)!;
    setSaving(true);
    setError('');
    try {
      await addReading(
        {
          cycle_id: openCycle.id!,
          meter_id: targetMeterId!,
          user_id: selectedUserId,
          prev_reading_tenths: prevTenths,
          curr_reading_tenths: currTenths,
          recorded_at: new Date(recordedAt).toISOString(),
          notes,
        },
        gapResolution,
        overlapResolution
      );
      setCurrStr('');
      setNotes('');
      setRecordedAt(toDateTimeLocalValue());
      setGapPrompt(null);
      setOverlapPrompt(null);
      setAnomalyConfirm(null);
      setSuccessMsg('تم حفظ القراءة بنجاح');
      setTimeout(() => setSuccessMsg(''), 3000);
      onReadingSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent, bypassAnomaly = false) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!targetMeterId) {
      setError('يرجى اختيار العداد');
      return;
    }
    if (!selectedUserId) {
      setError('يرجى اختيار المستخدم');
      return;
    }

    const prevTenths = parseKwhToTenths(prevStr);
    const currTenths = parseKwhToTenths(currStr);
    if (prevTenths === null || currTenths === null) {
      setError('يرجى إدخال القراءة السابقة والحالية بشكل صحيح');
      return;
    }
    if (currTenths < prevTenths) {
      setError('القراءة الحالية لا يمكن أن تكون أقل من القراءة السابقة');
      return;
    }
    if (currTenths === prevTenths) {
      setError('القراءة الحالية لا يمكن أن تساوي القراءة السابقة (السحب يجب أن يكون أكبر من 0.0)');
      return;
    }

    const delta = currTenths - prevTenths;
    if (!bypassAnomaly) {
      if (delta > settings.anomaly_threshold_tenths) {
        setAnomalyConfirm(
          `تنبيه: كمية السحب (${formatKwh(delta)} ك.و) تتجاوز حد التنبيه (${formatKwh(
            settings.anomaly_threshold_tenths
          )} ك.و). هل أنت متأكد من صحة القراءة؟`
        );
        return;
      }
    }

    // Check for gap or overlap on MAIN meter
    if (meterMode === 'MAIN') {
      const gap = await detectMainMeterGap(
        openCycle.id!,
        activeMainMeter.id!,
        prevTenths
      );
      if (gap) {
        setGapPrompt({
          lastRecordedTenths: gap.lastRecordedTenths,
          enteredPrevTenths: prevTenths,
          gapTenths: gap.gapTenths,
        });
        return;
      }

      const overlap = await detectMainMeterOverlap(
        openCycle.id!,
        activeMainMeter.id!,
        prevTenths,
        currTenths
      );
      if (overlap) {
        setOverlapPrompt({
          overlappingReadings: overlap.overlappingReadings,
          enteredPrevTenths: prevTenths,
          enteredCurrTenths: currTenths,
          deltaTenths: currTenths - prevTenths,
          affectedCount: overlap.affectedCount,
          nextCandidate: overlap.nextCandidate,
          prevCandidate: overlap.prevCandidate,
        });
        return;
      }
    }

    await executeSave({ mode: 'NONE' });
  };

  return (
    <div className="space-y-4">
      {/* Main / Sub Toggle */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-200/75 p-1.5">
        <button
          type="button"
          onClick={() => setMeterMode('MAIN')}
          className={`min-h-[44px] rounded-xl text-sm font-bold transition ${
            meterMode === 'MAIN'
              ? 'bg-white text-teal-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          عداد رئيسي
        </button>
        <button
          type="button"
          disabled={subMeters.length === 0}
          onClick={() => setMeterMode('SUB')}
          className={`min-h-[44px] rounded-xl text-sm font-bold transition disabled:opacity-45 ${
            meterMode === 'SUB'
              ? 'bg-white text-teal-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          عداد فرعي {subMeters.length === 0 ? '(لا يوجد)' : ''}
        </button>
      </div>

      <form
        onSubmit={(e) => handleSubmit(e, false)}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
      >
        {meterMode === 'SUB' && subMeters.length > 0 && (
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              العداد الفرعي
            </label>
            <select
              value={selectedSubMeterId}
              onChange={(e) => setSelectedSubMeterId(Number(e.target.value))}
              className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
            >
              {subMeters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] font-medium text-teal-700">
              سيتم تزامن الاستهلاك تلقائياً مع العداد الرئيسي دون احتسابه مرتين.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            المستخدم
          </label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(Number(e.target.value))}
            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <NumericInput
              id="prev-reading"
              label="القراءة السابقة"
              value={prevStr}
              onChange={setPrevStr}
              suffix="ك.و"
              placeholder="0.0"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => adjustFieldByTenth(prevStr, setPrevStr, 1)}
                className="min-h-[44px] rounded-xl border border-slate-300 bg-slate-50 text-sm font-bold text-slate-800 hover:bg-slate-100 active:scale-[0.98]"
              >
                +0.1
              </button>
              <button
                type="button"
                onClick={() => adjustFieldByTenth(prevStr, setPrevStr, -1)}
                className="min-h-[44px] rounded-xl border border-slate-300 bg-slate-50 text-sm font-bold text-slate-800 hover:bg-slate-100 active:scale-[0.98]"
              >
                -0.1
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <NumericInput
              id="curr-reading"
              label="القراءة الحالية"
              value={currStr}
              onChange={setCurrStr}
              suffix="ك.و"
              placeholder="0.0"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => adjustFieldByTenth(currStr, setCurrStr, 1)}
                className="min-h-[44px] rounded-xl border border-teal-200 bg-teal-50 text-sm font-bold text-teal-800 hover:bg-teal-100 active:scale-[0.98]"
              >
                +0.1
              </button>
              <button
                type="button"
                onClick={() => adjustFieldByTenth(currStr, setCurrStr, -1)}
                className="min-h-[44px] rounded-xl border border-teal-200 bg-teal-50 text-sm font-bold text-teal-800 hover:bg-teal-100 active:scale-[0.98]"
              >
                -0.1
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview Card */}
        <div className="flex items-center justify-between rounded-xl border border-teal-100 bg-teal-50/70 px-4 py-3">
          <div className="flex items-center gap-2 text-teal-900">
            <Gauge className="h-5 w-5 text-teal-700" />
            <div>
              <p className="text-[11px] font-semibold text-teal-700">كمية السحب</p>
              <p className="text-lg font-bold tabular-nums">
                {preview ? `${formatKwh(preview.delta)} ك.و` : '—'}
              </p>
            </div>
          </div>
          <div className="text-left">
            <p className="text-[11px] font-semibold text-teal-700">التكلفة التقديرية</p>
            <p className="text-lg font-bold tabular-nums text-teal-900">
              {preview
                ? `${formatCurrency(preview.costAgorot)} ${settings.currency_symbol}`
                : '—'}
            </p>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            التاريخ والوقت
          </label>
          <input
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            ملاحظة (اختياري)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="أي تفاصيل إضافية..."
            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900"
          />
        </div>

        {anomalyConfirm && (
          <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-bold text-amber-900">{anomalyConfirm}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={(e) => handleSubmit(e, true)}
                className="min-h-[44px] flex-1 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white"
              >
                نعم، متأكد — احفظ
              </button>
              <button
                type="button"
                onClick={() => setAnomalyConfirm(null)}
                className="min-h-[44px] rounded-xl border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900"
              >
                تعديل الرقم
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            <span>{successMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="min-h-[48px] w-full rounded-xl bg-teal-700 px-4 text-base font-bold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? 'جارٍ الحفظ...' : 'حفظ القراءة'}
        </button>
      </form>

      {gapPrompt && (
        <GapDetectionModal
          open={!!gapPrompt}
          lastRecordedTenths={gapPrompt.lastRecordedTenths}
          enteredPrevTenths={gapPrompt.enteredPrevTenths}
          gapTenths={gapPrompt.gapTenths}
          users={users}
          onSaveAsPendingGap={() => executeSave({ mode: 'PENDING_GAP' })}
          onAssignToUser={(gapUserId) =>
            executeSave({ mode: 'ASSIGN_TO_USER', gap_user_id: gapUserId })
          }
          onEditValue={() => setGapPrompt(null)}
        />
      )}

      {overlapPrompt && (
        <OverlapDetectionModal
          open={!!overlapPrompt}
          overlappingReadings={overlapPrompt.overlappingReadings}
          enteredPrevTenths={overlapPrompt.enteredPrevTenths}
          enteredCurrTenths={overlapPrompt.enteredCurrTenths}
          deltaTenths={overlapPrompt.deltaTenths}
          affectedCount={overlapPrompt.affectedCount}
          nextCandidate={overlapPrompt.nextCandidate}
          prevCandidate={overlapPrompt.prevCandidate}
          users={users}
          onInsertAndShift={() =>
            executeSave({ mode: 'NONE' }, 'INSERT_AND_SHIFT')
          }
          onDeductFromNext={() =>
            executeSave({ mode: 'NONE' }, 'DEDUCT_FROM_NEXT')
          }
          onDeductFromPrev={() =>
            executeSave({ mode: 'NONE' }, 'DEDUCT_FROM_PREV')
          }
          onKeepAsIs={() => executeSave({ mode: 'NONE' }, 'KEEP_AS_IS')}
          onEditValue={() => setOverlapPrompt(null)}
        />
      )}
    </div>
  );
};
