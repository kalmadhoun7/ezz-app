import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { NumericInput } from '../common/NumericInput';
import { getSuggestedOpeningReading, openNewCycle } from '../../db/cycleService';
import { formatKwh, formatCurrency, toDateTimeLocalValue } from '../../utils/format';
import { parseCurrencyToAgorot, parseKwhToTenths } from '../../utils/math';
import type { Meter, Settings } from '../../types/models';

interface OpenCycleModalProps {
  open: boolean;
  onClose: () => void;
  mainMeter: Meter | undefined;
  settings: Settings;
  onOpened: () => void;
}

export const OpenCycleModal: React.FC<OpenCycleModalProps> = ({
  open,
  onClose,
  mainMeter,
  settings,
  onOpened,
}) => {
  const [title, setTitle] = useState('');
  const [openingStr, setOpeningStr] = useState('0.0');
  const [priceStr, setPriceStr] = useState(
    formatCurrency(settings.default_kwh_price_agorot)
  );
  const [startDate, setStartDate] = useState(() => toDateTimeLocalValue());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && mainMeter?.id) {
      setPriceStr(formatCurrency(settings.default_kwh_price_agorot));
      setStartDate(toDateTimeLocalValue());
      setTitle('');
      setError('');
      getSuggestedOpeningReading(mainMeter.id).then((suggested) => {
        setOpeningStr(formatKwh(suggested));
      });
    }
  }, [open, mainMeter?.id, settings.default_kwh_price_agorot]);

  if (!mainMeter) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const openingTenths = parseKwhToTenths(openingStr);
    const priceAgorot = parseCurrencyToAgorot(priceStr);
    if (openingTenths === null) {
      setError('يرجى إدخال قراءة افتتاحية صحيحة');
      return;
    }
    if (priceAgorot === null || priceAgorot <= 0) {
      setError('يرجى إدخال سعر كيلو واط صحيح');
      return;
    }

    setSaving(true);
    try {
      await openNewCycle({
        meter_id: mainMeter.id!,
        title: title.trim() || undefined,
        opening_reading_tenths: openingTenths,
        kwh_price_agorot: priceAgorot,
        start_date: new Date(startDate).toISOString(),
      });
      onOpened();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر فتح الدورة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`فتح دورة جديدة — ${mainMeter.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            اسم / عنوان الدورة (اختياري)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثال: دورة تشرين الثاني"
            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumericInput
            label="القراءة الافتتاحية"
            value={openingStr}
            onChange={setOpeningStr}
            suffix="ك.و"
          />
          <NumericInput
            label={`سعر الكيلو (${settings.currency_symbol})`}
            value={priceStr}
            onChange={setPriceStr}
            maxDecimals={2}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            تاريخ البدء
          </label>
          <input
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
          />
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="min-h-[48px] w-full rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? 'جارٍ الفتح...' : 'فتح الدورة الآن'}
        </button>
      </form>
    </Modal>
  );
};
