import React, { useEffect, useState } from 'react';
import {
  UserPlus,
  Gauge,
  Settings as SettingsIcon,
  Archive,
  Pencil,
  CheckCircle2,
  Banknote,
  Download,
  Upload,
} from 'lucide-react';
import { NumericInput } from '../common/NumericInput';
import { PaymentModal } from './PaymentModal';
import {
  addUser,
  archiveOrDeleteUser,
  getUserFinancialSummary,
  updateUser,
  type UserFinancialSummary,
} from '../../db/userService';
import { addMeter, updateMeter } from '../../db/meterService';
import { updateSettings } from '../../db/settingsService';
import { exportFullBackup, restoreFullBackup } from '../../db/backupService';
import { downloadTextFile } from '../../utils/export';
import { formatCurrency, formatKwh } from '../../utils/format';
import { parseCurrencyToAgorot, parseKwhToTenths } from '../../utils/math';
import type { Meter, Settings, User } from '../../types/models';

interface UsersAndSettingsTabProps {
  users: User[];
  allMeters: Meter[];
  settings: Settings;
}

export const UsersAndSettingsTab: React.FC<UsersAndSettingsTabProps> = ({
  users,
  allMeters,
  settings,
}) => {
  const [section, setSection] = useState<'users' | 'meters' | 'settings'>('users');

  // User form state
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [userNotes, setUserNotes] = useState('');
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [userMsg, setUserMsg] = useState('');
  const [userErr, setUserErr] = useState('');
  const [paymentUser, setPaymentUser] = useState<User | null>(null);
  const [summaries, setSummaries] = useState<Record<number, UserFinancialSummary>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    Promise.all(users.map((u) => getUserFinancialSummary(u.id!))).then((list) => {
      const map: Record<number, UserFinancialSummary> = {};
      for (const s of list) map[s.userId] = s;
      setSummaries(map);
    });
  }, [users, refreshTick]);

  // Meter form state
  const mainMeters = allMeters.filter((m) => m.type === 'MAIN' && m.is_active);
  const [meterName, setMeterName] = useState('');
  const [meterType, setMeterType] = useState<'MAIN' | 'SUB'>('SUB');
  const [parentMeterId, setParentMeterId] = useState<number>(mainMeters[0]?.id ?? 0);
  const [defaultUserId, setDefaultUserId] = useState<number | ''>('');
  const [meterErr, setMeterErr] = useState('');
  const [meterMsg, setMeterMsg] = useState('');

  // Settings form state
  const [priceStr, setPriceStr] = useState(
    formatCurrency(settings.default_kwh_price_agorot)
  );
  const [currency, setCurrency] = useState(settings.currency_symbol);
  const [thresholdStr, setThresholdStr] = useState(
    formatKwh(settings.anomaly_threshold_tenths)
  );
  const [applyToOpen, setApplyToOpen] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [settingsErr, setSettingsErr] = useState('');

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserErr('');
    setUserMsg('');
    try {
      if (editingUserId !== null) {
        await updateUser(editingUserId, {
          name: userName,
          whatsapp_phone: userPhone,
          notes: userNotes,
        });
        setUserMsg('تم تحديث بيانات المستخدم');
        setEditingUserId(null);
      } else {
        await addUser({
          name: userName,
          whatsapp_phone: userPhone,
          notes: userNotes,
        });
        setUserMsg('تمت إضافة المستخدم بنجاح');
      }
      setUserName('');
      setUserPhone('');
      setUserNotes('');
      setTimeout(() => setUserMsg(''), 2500);
    } catch (err) {
      setUserErr(err instanceof Error ? err.message : 'تعذر حفظ المستخدم');
    }
  };

  const handleSaveMeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setMeterErr('');
    setMeterMsg('');
    try {
      await addMeter({
        name: meterName,
        type: meterType,
        parent_meter_id:
          meterType === 'SUB' ? parentMeterId || mainMeters[0]?.id || null : null,
        default_user_id:
          meterType === 'SUB' && defaultUserId !== '' ? Number(defaultUserId) : null,
      });
      setMeterName('');
      setDefaultUserId('');
      setMeterMsg('تمت إضافة العداد بنجاح');
      setTimeout(() => setMeterMsg(''), 2500);
    } catch (err) {
      setMeterErr(err instanceof Error ? err.message : 'تعذر حفظ العداد');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsErr('');
    setSettingsMsg('');
    const priceAgorot = parseCurrencyToAgorot(priceStr);
    const thresholdTenths = parseKwhToTenths(thresholdStr);
    if (priceAgorot === null || priceAgorot <= 0) {
      setSettingsErr('يرجى إدخال سعر كيلو واط صحيح');
      return;
    }
    if (thresholdTenths === null || thresholdTenths <= 0) {
      setSettingsErr('يرجى إدخال حد تنبيه صحيح');
      return;
    }
    await updateSettings(
      {
        default_kwh_price_agorot: priceAgorot,
        currency_symbol: currency.trim() || 'شيكل',
        anomaly_threshold_tenths: thresholdTenths,
      },
      applyToOpen
    );
    setApplyToOpen(false);
    setSettingsMsg('تم حفظ الإعدادات بنجاح');
    setTimeout(() => setSettingsMsg(''), 2500);
  };

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-200/75 p-1.5">
        <button
          type="button"
          onClick={() => setSection('users')}
          className={`min-h-[44px] rounded-xl text-xs font-bold transition ${
            section === 'users' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600'
          }`}
        >
          المستخدمون
        </button>
        <button
          type="button"
          onClick={() => setSection('meters')}
          className={`min-h-[44px] rounded-xl text-xs font-bold transition ${
            section === 'meters' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600'
          }`}
        >
          العدادات
        </button>
        <button
          type="button"
          onClick={() => setSection('settings')}
          className={`min-h-[44px] rounded-xl text-xs font-bold transition ${
            section === 'settings' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600'
          }`}
        >
          الإعدادات
        </button>
      </div>

      {/* USERS SECTION */}
      {section === 'users' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveUser}
            className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
          >
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <UserPlus className="h-4 w-4 text-teal-700" />
              <span>{editingUserId ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</span>
            </h3>
            <input
              type="text"
              required
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="الاسم الكامل (إلزامي وفريد)"
              className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold"
            />
            <input
              type="tel"
              dir="ltr"
              value={userPhone}
              onChange={(e) => setUserPhone(e.target.value)}
              placeholder="رقم الواتساب (اختياري، مثال: 970599000000)"
              className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-right text-sm"
            />
            <input
              type="text"
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="ملاحظات (اختياري)"
              className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-sm"
            />
            {userErr && (
              <p className="rounded-xl bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
                {userErr}
              </p>
            )}
            {userMsg && (
              <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {userMsg}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                className="min-h-[44px] flex-1 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800"
              >
                {editingUserId ? 'حفظ التعديل' : 'إضافة المستخدم'}
              </button>
              {editingUserId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingUserId(null);
                    setUserName('');
                    setUserPhone('');
                    setUserNotes('');
                  }}
                  className="min-h-[44px] rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
                >
                  إلغاء
                </button>
              )}
            </div>
          </form>

          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-800">
              قائمة المستخدمين ({users.length})
            </h4>
            {users.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-500">
                لا يوجد مستخدمون مسجلون بعد.
              </div>
            ) : (
              users.map((u) => {
                const sum = summaries[u.id!];
                const bal = sum?.balanceDueAgorot ?? 0;
                return (
                  <div
                    key={u.id}
                    className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{u.name}</p>
                        <p className="text-xs text-slate-500">
                          {u.whatsapp_phone || 'بدون رقم واتساب'}
                          {u.notes ? ` • ${u.notes}` : ''}
                        </p>
                      </div>
                      <div className="text-left">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                            bal > 0
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {bal > 0
                            ? `عليه ${formatCurrency(bal)} ${settings.currency_symbol}`
                            : bal < 0
                            ? `رصيد دائن ${formatCurrency(Math.abs(bal))} ${settings.currency_symbol}`
                            : 'مسدد بالكامل'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                      <button
                        type="button"
                        onClick={() => setPaymentUser(u)}
                        className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-50 px-3 text-xs font-bold text-teal-800 hover:bg-teal-100"
                      >
                        <Banknote className="h-4 w-4" />
                        <span>تسجيل دفعة مالية</span>
                      </button>
                      <button
                        type="button"
                        aria-label="تعديل المستخدم"
                        onClick={() => {
                          setEditingUserId(u.id!);
                          setUserName(u.name);
                          setUserPhone(u.whatsapp_phone ?? '');
                          setUserNotes(u.notes);
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-teal-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="أرشفة المستخدم"
                        onClick={async () => {
                          if (
                            window.confirm(`هل تريد أرشفة/حذف المستخدم "${u.name}"؟`)
                          ) {
                            await archiveOrDeleteUser(u.id!);
                          }
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* METERS SECTION */}
      {section === 'meters' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveMeter}
            className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
          >
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Gauge className="h-4 w-4 text-teal-700" />
              <span>إضافة عداد جديد</span>
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMeterType('MAIN')}
                className={`min-h-[44px] rounded-xl border text-xs font-bold ${
                  meterType === 'MAIN'
                    ? 'border-teal-700 bg-teal-50 text-teal-800'
                    : 'border-slate-300 text-slate-600'
                }`}
              >
                عداد رئيسي
              </button>
              <button
                type="button"
                onClick={() => setMeterType('SUB')}
                className={`min-h-[44px] rounded-xl border text-xs font-bold ${
                  meterType === 'SUB'
                    ? 'border-teal-700 bg-teal-50 text-teal-800'
                    : 'border-slate-300 text-slate-600'
                }`}
              >
                عداد فرعي
              </button>
            </div>
            <input
              type="text"
              required
              value={meterName}
              onChange={(e) => setMeterName(e.target.value)}
              placeholder="اسم العداد (مثال: عداد الطابق الثاني)"
              className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold"
            />
            {meterType === 'SUB' && (
              <>
                <select
                  value={parentMeterId || (mainMeters[0]?.id ?? '')}
                  onChange={(e) => setParentMeterId(Number(e.target.value))}
                  className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
                >
                  {mainMeters.map((m) => (
                    <option key={m.id} value={m.id}>
                      مرتبط بـ: {m.name}
                    </option>
                  ))}
                </select>
                <select
                  value={defaultUserId}
                  onChange={(e) =>
                    setDefaultUserId(e.target.value ? Number(e.target.value) : '')
                  }
                  className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
                >
                  <option value="">المستخدم الافتراضي للفرعي (اختياري)</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {meterErr && (
              <p className="rounded-xl bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
                {meterErr}
              </p>
            )}
            {meterMsg && (
              <p className="rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
                {meterMsg}
              </p>
            )}
            <button
              type="submit"
              className="min-h-[44px] w-full rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800"
            >
              إضافة العداد
            </button>
          </form>

          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-800">العدادات المسجلة</h4>
            {allMeters.map((m) => {
              const defUser = users.find((u) => u.id === m.default_user_id);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{m.name}</span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          m.type === 'MAIN'
                            ? 'bg-teal-100 text-teal-800'
                            : 'bg-indigo-100 text-indigo-800'
                        }`}
                      >
                        {m.type === 'MAIN' ? 'رئيسي' : 'فرعي'}
                      </span>
                    </div>
                    {m.type === 'SUB' && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        المستخدم الافتراضي: {defUser?.name ?? 'غير محدد'}
                      </p>
                    )}
                  </div>
                  {m.type === 'SUB' && (
                    <select
                      aria-label="تغيير المستخدم الافتراضي"
                      value={m.default_user_id ?? ''}
                      onChange={(e) =>
                        updateMeter(m.id!, {
                          default_user_id: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="min-h-[44px] max-w-[140px] rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold"
                    >
                      <option value="">بدون افتراضي</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SETTINGS SECTION */}
      {section === 'settings' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveSettings}
            className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
          >
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <SettingsIcon className="h-4 w-4 text-teal-700" />
              <span>إعدادات التسعيرة والتنبيهات</span>
            </h3>

            <NumericInput
              label={`سعر الكيلو واط الافتراضي (${currency})`}
              value={priceStr}
              onChange={setPriceStr}
              maxDecimals={2}
            />

            <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={applyToOpen}
                onChange={(e) => setApplyToOpen(e.target.checked)}
              />
              <span>تطبيق السعر الجديد على الدورات المفتوحة حالياً أيضاً (لا يؤثر على المغلقة)</span>
            </label>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                رمز العملة
              </label>
              <input
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold"
              />
            </div>

            <NumericInput
              label="حد التنبيه للقراءات الشاذة (ك.و)"
              value={thresholdStr}
              onChange={setThresholdStr}
              suffix="ك.و"
            />

            {settingsErr && (
              <p className="rounded-xl bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
                {settingsErr}
              </p>
            )}
            {settingsMsg && (
              <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {settingsMsg}
              </p>
            )}

            <button
              type="submit"
              className="min-h-[48px] w-full rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800"
            >
              حفظ الإعدادات
            </button>
          </form>

          {/* Backup & Restore */}
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900">
              النسخ الاحتياطي والاستعادة (JSON)
            </h3>
            <p className="text-xs text-slate-500">
              احفظ نسخة كاملة من جميع البيانات محلياً، أو استعدها على هاتف آخر.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={async () => {
                  const payload = await exportFullBackup();
                  const datePart = new Date().toISOString().slice(0, 10);
                  downloadTextFile(
                    JSON.stringify(payload, null, 2),
                    `meter_backup_${datePart}.json`,
                    'application/json;charset=utf-8;'
                  );
                }}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800"
              >
                <Download className="h-4 w-4" />
                <span>تصدير نسخة</span>
              </button>

              <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-bold text-slate-800 hover:bg-slate-100">
                <Upload className="h-4 w-4" />
                <span>استعادة نسخة</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    if (
                      !window.confirm(
                        'سيتم استبدال كافة البيانات الحالية بالنسخة الاحتياطية. هل تريد المتابعة؟'
                      )
                    ) {
                      e.target.value = '';
                      return;
                    }
                    try {
                      await restoreFullBackup(text);
                      setSettingsMsg('تمت استعادة النسخة الاحتياطية بنجاح');
                      setRefreshTick((t) => t + 1);
                    } catch (err) {
                      setSettingsErr(
                        err instanceof Error ? err.message : 'فشل استعادة النسخة'
                      );
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      <PaymentModal
        user={paymentUser}
        settings={settings}
        onClose={() => setPaymentUser(null)}
        onSaved={() => setRefreshTick((t) => t + 1)}
      />
    </div>
  );
};
