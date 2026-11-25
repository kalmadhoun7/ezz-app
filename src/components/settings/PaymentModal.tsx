import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { NumericInput } from '../common/NumericInput';
import { addPayment } from '../../db/paymentService';
import { parseCurrencyToAgorot } from '../../utils/math';
import { toDateTimeLocalValue } from '../../utils/format';
import type { Settings, User } from '../../types/models';

interface PaymentModalProps {
  user: User | null;
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  user,
  settings,
  onClose,
  onSaved,
}) => {
  const [amountStr, setAmountStr] = useState('');
  const [dateStr, setDateStr] = useState(() => toDateTimeLocalValue());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const amountAgorot = parseCurrencyToAgorot(amountStr);
    if (amountAgorot === null || amountAgorot <= 0) {
      setError('يرجى إدخال مبلغ صحيح أكبر من صفر');
      return;
    }

    setSaving(true);
    try {
      await addPayment({
        user_id: user.id!,
        amount_agorot: amountAgorot,
        payment_date: new Date(dateStr).toISOString(),
        notes,
      });
      setAmountStr('');
      setNotes('');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدفعة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!user} onClose={onClose} title={`تسجيل دفعة مالية — ${user.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <NumericInput
          label={`المبلغ المدفوع (${settings.currency_symbol})`}
          value={amountStr}
          onChange={setAmountStr}
          maxDecimals={2}
          placeholder="0.00"
          autoFocus
        />

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            تاريخ الدفعة
          </label>
          <input
            type="datetime-local"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold"
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
            placeholder="دفعة جزئية / سداد كامل..."
            className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-sm"
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
          {saving ? 'جارٍ الحفظ...' : 'حفظ الدفعة'}
        </button>
      </form>
    </Modal>
  );
};
