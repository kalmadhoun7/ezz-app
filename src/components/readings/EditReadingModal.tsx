import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { NumericInput } from '../common/NumericInput';
import { formatKwh, toDateTimeLocalValue } from '../../utils/format';
import { parseKwhToTenths } from '../../utils/math';
import { updateReading } from '../../db/readingService';
import type { Reading, User } from '../../types/models';

interface EditReadingModalProps {
  reading: Reading | null;
  users: User[];
  onClose: () => void;
  onSaved: () => void;
}

export const EditReadingModal: React.FC<EditReadingModalProps> = ({
  reading,
  users,
  onClose,
  onSaved,
}) => {
  const [userId, setUserId] = useState<number>(0);
  const [prevStr, setPrevStr] = useState('');
  const [currStr, setCurrStr] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (reading) {
      setUserId(reading.user_id);
      setPrevStr(formatKwh(reading.prev_reading_tenths));
      setCurrStr(formatKwh(reading.curr_reading_tenths));
      setRecordedAt(toDateTimeLocalValue(reading.recorded_at));
      setNotes(reading.notes);
      setError('');
    }
  }, [reading]);

  if (!reading) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const prevTenths = parseKwhToTenths(prevStr);
    const currTenths = parseKwhToTenths(currStr);

    if (prevTenths === null || currTenths === null) {
      setError('يرجى إدخال قراءات صحيحة');
      return;
    }
    if (currTenths < prevTenths) {
      setError('القراءة الحالية لا يمكن أن تكون أقل من القراءة السابقة');
      return;
    }

    setSaving(true);
    try {
      await updateReading(reading.id!, {
        user_id: userId,
        prev_reading_tenths: prevTenths,
        curr_reading_tenths: currTenths,
        recorded_at: new Date(recordedAt).toISOString(),
        notes,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!reading} onClose={onClose} title="تعديل القراءة">
      <form onSubmit={handleSave} className="space-y-4">
        {reading.linked_sub_reading_id && (
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs font-semibold text-teal-800">
            هذه القراءة متزامنة مع عداد فرعي؛ سيتم تحديث القراءة المرتبطة تلقائياً.
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            المستخدم
          </label>
          <select
            value={userId}
            onChange={(e) => setUserId(Number(e.target.value))}
            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumericInput
            label="القراءة السابقة"
            value={prevStr}
            onChange={setPrevStr}
            suffix="ك.و"
          />
          <NumericInput
            label="القراءة الحالية"
            value={currStr}
            onChange={setCurrStr}
            suffix="ك.و"
          />
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
            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900"
          />
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 p-2.5 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] flex-1 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
};
