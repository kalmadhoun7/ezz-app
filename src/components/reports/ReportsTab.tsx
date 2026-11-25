import React, { useEffect, useState } from 'react';
import {
  Copy,
  FileSpreadsheet,
  FileText,
  MessageCircle,
  Share2,
  Check,
} from 'lucide-react';
import { NumericInput } from '../common/NumericInput';
import {
  buildInvoiceMessage,
  getCycleOrDateRangeReport,
  getReadingRangeReport,
  getUserFullStatement,
  type ReadingRangeReportRow,
  type UserCycleReportRow,
  type UserStatementRow,
} from '../../db/reportService';
import { exportHtmlPdfReport, exportXlsxWorkbook } from '../../utils/export';
import { formatCurrency, formatDateAr, formatKwh } from '../../utils/format';
import { parseKwhToTenths } from '../../utils/math';
import type { Cycle, Meter, Reading, Settings, User } from '../../types/models';

interface ReportsTabProps {
  activeMainMeter: Meter | undefined;
  cycles: Cycle[];
  users: User[];
  settings: Settings;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({
  activeMainMeter,
  cycles,
  users,
  settings,
}) => {
  const [queryMode, setQueryMode] = useState<'cycle' | 'range' | 'statement'>('cycle');

  // Share template controls (FR-28)
  const [invoiceMode, setInvoiceMode] = useState<'COMPACT' | 'DETAILED'>(
    settings.default_invoice_mode
  );
  const [showDiscount, setShowDiscount] = useState(settings.show_discount_by_default);
  const [copiedUserId, setCopiedUserId] = useState<number | null>(null);

  // Mode 1: Cycle / Date Range
  const [selectedCycleId, setSelectedCycleId] = useState<number | ''>(
    cycles[0]?.id ?? ''
  );
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [cycleRows, setCycleRows] = useState<UserCycleReportRow[]>([]);
  const [cycleReadings, setCycleReadings] = useState<Reading[]>([]);
  const [activeCycleObj, setActiveCycleObj] = useState<Cycle | undefined>();

  // Mode 2: Meter Reading Range [X, Y]
  const [fromReadingStr, setFromReadingStr] = useState('');
  const [toReadingStr, setToReadingStr] = useState('');
  const [rangeRows, setRangeRows] = useState<ReadingRangeReportRow[]>([]);

  // Mode 3: User Statement
  const [statementUserId, setStatementUserId] = useState<number>(users[0]?.id ?? 0);
  const [statementData, setStatementData] = useState<{
    rows: UserStatementRow[];
    totalPaidAgorot: number;
    finalBalanceAgorot: number;
  }>({ rows: [], totalPaidAgorot: 0, finalBalanceAgorot: 0 });

  useEffect(() => {
    if (cycles.length > 0 && selectedCycleId === '') {
      setSelectedCycleId(cycles[0].id!);
    }
  }, [cycles, selectedCycleId]);

  useEffect(() => {
    if (!activeMainMeter?.id || queryMode !== 'cycle') return;
    getCycleOrDateRangeReport({
      mainMeterId: activeMainMeter.id,
      cycleId: selectedCycleId !== '' ? Number(selectedCycleId) : undefined,
      fromDate: selectedCycleId === '' && fromDate ? new Date(fromDate).toISOString() : undefined,
      toDate: selectedCycleId === '' && toDate ? new Date(toDate).toISOString() : undefined,
    }).then((res) => {
      setCycleRows(res.rows);
      setCycleReadings(res.readings);
      setActiveCycleObj(res.cycle);
    });
  }, [activeMainMeter?.id, queryMode, selectedCycleId, fromDate, toDate]);

  useEffect(() => {
    if (!activeMainMeter?.id || queryMode !== 'range') return;
    const x = parseKwhToTenths(fromReadingStr);
    const y = parseKwhToTenths(toReadingStr);
    if (x === null || y === null || y <= x) {
      setRangeRows([]);
      return;
    }
    getReadingRangeReport({
      mainMeterId: activeMainMeter.id,
      fromTenths: x,
      toTenths: y,
    }).then(setRangeRows);
  }, [activeMainMeter?.id, queryMode, fromReadingStr, toReadingStr]);

  useEffect(() => {
    if (queryMode !== 'statement' || !statementUserId) return;
    getUserFullStatement(statementUserId).then((res) => {
      setStatementData({
        rows: res.rows,
        totalPaidAgorot: res.totalPaidAgorot,
        finalBalanceAgorot: res.finalBalanceAgorot,
      });
    });
  }, [queryMode, statementUserId]);

  const userMap = new Map(users.map((u) => [u.id!, u.name]));

  const getMessageForRow = (row: UserCycleReportRow) =>
    buildInvoiceMessage({
      row,
      cycleTitle: activeCycleObj?.title ?? 'تقرير الفترة',
      startDate: activeCycleObj?.start_date ?? new Date().toISOString(),
      endDate: activeCycleObj?.end_date ?? null,
      isCycleClosed: activeCycleObj ? activeCycleObj.status === 'CLOSED' : false,
      settings,
      mode: invoiceMode,
      showDiscount,
    });

  const handleCopy = async (row: UserCycleReportRow) => {
    await navigator.clipboard.writeText(getMessageForRow(row));
    setCopiedUserId(row.userId);
    setTimeout(() => setCopiedUserId(null), 2000);
  };

  const handleShare = async (row: UserCycleReportRow) => {
    const text = getMessageForRow(row);
    if (navigator.share) {
      await navigator.share({ title: `فاتورة ${row.userName}`, text });
    } else {
      await handleCopy(row);
    }
  };

  const isDetailed = invoiceMode === 'DETAILED';

  const buildCycleTableData = () => {
    const headers = [
      'المستخدم',
      ...(isDetailed ? ['السحب (ك.و)'] : []),
      ...(isDetailed && showDiscount ? ['الخصم (ك.و)'] : []),
      `صافي الدورة (${settings.currency_symbol})`,
      `الرصيد التراكمي (${settings.currency_symbol})`,
    ];
    const rows = cycleRows.map((r) => [
      r.userName,
      ...(isDetailed ? [formatKwh(r.consumptionTenths)] : []),
      ...(isDetailed && showDiscount ? [formatKwh(r.discountKwhTenths)] : []),
      formatCurrency(r.netAmountAgorot),
      formatCurrency(r.cumulativeBalanceAgorot),
    ]);
    const sumKwh = cycleRows.reduce((s, r) => s + r.consumptionTenths, 0);
    const sumDisc = cycleRows.reduce((s, r) => s + r.discountKwhTenths, 0);
    const sumNet = cycleRows.reduce((s, r) => s + r.netAmountAgorot, 0);
    const sumBal = cycleRows.reduce((s, r) => s + r.cumulativeBalanceAgorot, 0);
    const totalsRow = [
      'المجموع',
      ...(isDetailed ? [formatKwh(sumKwh)] : []),
      ...(isDetailed && showDiscount ? [formatKwh(sumDisc)] : []),
      formatCurrency(sumNet),
      formatCurrency(sumBal),
    ];
    return { headers, rows, totalsRow, sumKwh, sumNet };
  };

  const handleExportCyclePdf = () => {
    const { headers, rows, totalsRow, sumKwh, sumNet } = buildCycleTableData();
    const cycleTitle = activeCycleObj?.title ?? 'تقرير الفترة';
    const period =
      activeCycleObj?.start_date
        ? `${formatDateAr(activeCycleObj.start_date)}${
            activeCycleObj.end_date ? ` — ${formatDateAr(activeCycleObj.end_date)}` : ''
          }`
        : undefined;

    exportHtmlPdfReport({
      title: `تقرير ${cycleTitle}`,
      subtitle: activeMainMeter ? `العداد: ${activeMainMeter.name}` : undefined,
      meta: [
        ...(period ? [{ label: 'الفترة', value: period }] : []),
        ...(isDetailed && activeCycleObj
          ? [
              {
                label: 'سعر الكيلو',
                value: `${formatCurrency(activeCycleObj.kwh_price_agorot)} ${
                  settings.currency_symbol
                }`,
              },
            ]
          : []),
        ...(isDetailed
          ? [{ label: 'إجمالي السحب', value: `${formatKwh(sumKwh)} ك.و` }]
          : []),
        {
          label: 'إجمالي المستحق',
          value: `${formatCurrency(sumNet)} ${settings.currency_symbol}`,
        },
      ],
      headers,
      rows,
      totalsRow,
    });
  };

  const handleExportCycleXlsx = () => {
    const { headers, rows, totalsRow } = buildCycleTableData();
    const cycleTitle = activeCycleObj?.title ?? 'الدورة';

    const sheets = [
      {
        name: 'ملخص المستخدمين',
        title: `تقرير ${cycleTitle}`,
        subtitle: activeMainMeter ? `العداد: ${activeMainMeter.name}` : undefined,
        headers,
        rows,
        totalsRow,
      },
    ];

    if (isDetailed) {
      const detailHeaders = ['المستخدم', 'السابق (ك.و)', 'الحالي (ك.و)', 'السحب (ك.و)', 'التاريخ'];
      const detailRows = cycleReadings.map((r) => [
        userMap.get(r.user_id) ?? 'مستخدم',
        formatKwh(r.prev_reading_tenths),
        formatKwh(r.curr_reading_tenths),
        formatKwh(r.consumption_tenths),
        formatDateAr(r.recorded_at),
      ]);
      const detailSumKwh = cycleReadings.reduce((s, r) => s + r.consumption_tenths, 0);
      sheets.push({
        name: 'تفاصيل القراءات',
        title: `تفاصيل قراءات ${cycleTitle}`,
        subtitle: undefined,
        headers: detailHeaders,
        rows: detailRows,
        totalsRow: ['المجموع', '', '', formatKwh(detailSumKwh), ''],
      });
    }

    exportXlsxWorkbook(
      sheets,
      `تقرير_${cycleTitle.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`
    );
  };

  const handleExportStatementPdf = () => {
    const uName = userMap.get(statementUserId) ?? 'مستخدم';
    const headers = [
      'الدورة',
      ...(isDetailed ? ['السحب (ك.و)'] : []),
      ...(isDetailed && showDiscount ? ['الخصم (ك.و)'] : []),
      `المستحق (${settings.currency_symbol})`,
      `التراكمي (${settings.currency_symbol})`,
    ];
    const rows = statementData.rows.map((r) => [
      r.cycleTitle,
      ...(isDetailed ? [formatKwh(r.consumptionTenths)] : []),
      ...(isDetailed && showDiscount ? [formatKwh(r.discountKwhTenths)] : []),
      formatCurrency(r.netAmountAgorot),
      formatCurrency(r.cumulativeDueAfterCycleAgorot),
    ]);
    const sumKwh = statementData.rows.reduce((s, r) => s + r.consumptionTenths, 0);
    const sumDisc = statementData.rows.reduce((s, r) => s + r.discountKwhTenths, 0);
    const sumNet = statementData.rows.reduce((s, r) => s + r.netAmountAgorot, 0);

    exportHtmlPdfReport({
      title: `كشف حساب — ${uName}`,
      meta: [
        {
          label: 'إجمالي الدفعات',
          value: `${formatCurrency(statementData.totalPaidAgorot)} ${settings.currency_symbol}`,
        },
        {
          label: 'الرصيد المتبقي',
          value: `${formatCurrency(statementData.finalBalanceAgorot)} ${settings.currency_symbol}`,
        },
      ],
      headers,
      rows,
      totalsRow: [
        'المجموع',
        ...(isDetailed ? [formatKwh(sumKwh)] : []),
        ...(isDetailed && showDiscount ? [formatKwh(sumDisc)] : []),
        formatCurrency(sumNet),
        formatCurrency(statementData.finalBalanceAgorot),
      ],
    });
  };

  return (
    <div className="space-y-4">
      {/* 3 Query Tabs */}
      <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-200/75 p-1.5">
        <button
          type="button"
          onClick={() => setQueryMode('cycle')}
          className={`min-h-[44px] rounded-xl px-1 text-xs font-bold transition ${
            queryMode === 'cycle' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600'
          }`}
        >
          الدورة / التاريخ
        </button>
        <button
          type="button"
          onClick={() => setQueryMode('range')}
          className={`min-h-[44px] rounded-xl px-1 text-xs font-bold transition ${
            queryMode === 'range' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600'
          }`}
        >
          نطاق القراءات
        </button>
        <button
          type="button"
          onClick={() => setQueryMode('statement')}
          className={`min-h-[44px] rounded-xl px-1 text-xs font-bold transition ${
            queryMode === 'statement' ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600'
          }`}
        >
          كشف حساب
        </button>
      </div>

      {/* Invoice & Share Template Options */}
      <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-700">نمط الفاتورة والرسائل:</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setInvoiceMode('COMPACT')}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-bold ${
                invoiceMode === 'COMPACT'
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              مختصر (المبلغ فقط)
            </button>
            <button
              type="button"
              onClick={() => setInvoiceMode('DETAILED')}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-bold ${
                invoiceMode === 'DETAILED'
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              تفصيلي
            </button>
          </div>
        </div>
        {invoiceMode === 'DETAILED' && (
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={showDiscount}
              onChange={(e) => setShowDiscount(e.target.checked)}
            />
            <span>إظهار تفاصيل خصم الكيلوات</span>
          </label>
        )}
      </div>

      {/* MODE 1: CYCLE / DATE RANGE */}
      {queryMode === 'cycle' && (
        <div className="space-y-3">
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5">
            <select
              value={selectedCycleId}
              onChange={(e) =>
                setSelectedCycleId(e.target.value ? Number(e.target.value) : '')
              }
              className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold"
            >
              <option value="">نطاق تاريخ مخصص...</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.status === 'OPEN' ? 'مفتوحة' : 'مغلقة'})
                </option>
              ))}
            </select>

            {selectedCycleId === '' && (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-slate-300 px-2 text-xs font-semibold"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-slate-300 px-2 text-xs font-semibold"
                />
              </div>
            )}

            {cycleRows.length > 0 && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleExportCyclePdf}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-700 text-xs font-bold text-white hover:bg-rose-800"
                >
                  <FileText className="h-4 w-4" />
                  <span>تصدير PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCycleXlsx}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 text-xs font-bold text-white hover:bg-emerald-800"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>تصدير Excel</span>
                </button>
              </div>
            )}
          </div>

          {cycleRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-500">
              لا توجد بيانات مطابقة للعرض.
            </div>
          ) : (
            <div className="space-y-2">
              {cycleRows.map((row) => {
                const waUrl = row.whatsappPhone
                  ? `https://wa.me/${row.whatsappPhone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                      getMessageForRow(row)
                    )}`
                  : null;
                return (
                  <div
                    key={row.userId}
                    className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          {row.userName}
                        </h4>
                        {invoiceMode === 'DETAILED' && (
                          <p className="text-xs font-semibold tabular-nums text-slate-600">
                            السحب: {formatKwh(row.consumptionTenths)} ك.و
                            {showDiscount && row.discountKwhTenths > 0
                              ? ` • خصم: ${formatKwh(row.discountKwhTenths)} ك.و`
                              : ''}
                          </p>
                        )}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold tabular-nums text-teal-800">
                          {formatCurrency(row.netAmountAgorot)} {settings.currency_symbol}
                        </p>
                        <p
                          className={`text-[11px] font-bold tabular-nums ${
                            row.cumulativeBalanceAgorot > 0
                              ? 'text-rose-600'
                              : 'text-emerald-600'
                          }`}
                        >
                          الرصيد: {formatCurrency(row.cumulativeBalanceAgorot)}{' '}
                          {settings.currency_symbol}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 border-t border-slate-100 pt-2">
                      {waUrl ? (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
                        >
                          <MessageCircle className="h-4 w-4" />
                          <span>إرسال واتساب</span>
                        </a>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCopy(row)}
                            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-bold text-slate-800"
                          >
                            {copiedUserId === row.userId ? (
                              <>
                                <Check className="h-4 w-4 text-emerald-600" />
                                <span>تم النسخ</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4" />
                                <span>نسخ الفاتورة</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleShare(row)}
                            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-3 text-xs font-bold text-white"
                          >
                            <Share2 className="h-4 w-4" />
                            <span>مشاركة</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODE 2: METER READING RANGE [X, Y] */}
      {queryMode === 'range' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
            <NumericInput
              label="من قراءة"
              value={fromReadingStr}
              onChange={setFromReadingStr}
              suffix="ك.و"
              placeholder="1500.0"
            />
            <NumericInput
              label="إلى قراءة"
              value={toReadingStr}
              onChange={setToReadingStr}
              suffix="ك.و"
              placeholder="1550.0"
            />
          </div>

          {rangeRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-500">
              أدخل نطاق قراءات صالحاً لعرض الاستهلاك.
            </div>
          ) : (
            <div className="space-y-2">
              {rangeRows.map((r) => (
                <div
                  key={r.userId}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5"
                >
                  <span className="text-sm font-bold text-slate-900">{r.userName}</span>
                  <div className="text-left tabular-nums">
                    <p className="text-sm font-bold text-teal-800">
                      {formatKwh(r.consumptionTenths)} ك.و
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatCurrency(r.estimatedAmountAgorot)} {settings.currency_symbol}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODE 3: USER FULL STATEMENT */}
      {queryMode === 'statement' && (
        <div className="space-y-3">
          <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-3.5">
            <select
              value={statementUserId}
              onChange={(e) => setStatementUserId(Number(e.target.value))}
              className="min-h-[44px] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleExportStatementPdf}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-rose-700 px-3.5 text-xs font-bold text-white hover:bg-rose-800"
            >
              <FileText className="h-4 w-4" />
              <span>PDF</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 text-center">
            <div>
              <p className="text-xs text-slate-500">إجمالي الدفعات</p>
              <p className="text-sm font-bold tabular-nums text-emerald-700">
                {formatCurrency(statementData.totalPaidAgorot)}{' '}
                {settings.currency_symbol}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">الرصيد المتبقي</p>
              <p
                className={`text-sm font-bold tabular-nums ${
                  statementData.finalBalanceAgorot > 0
                    ? 'text-rose-600'
                    : 'text-emerald-700'
                }`}
              >
                {formatCurrency(statementData.finalBalanceAgorot)}{' '}
                {settings.currency_symbol}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {statementData.rows.map((r) => (
              <div
                key={r.cycleId}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 text-xs"
              >
                <div>
                  <p className="text-sm font-bold text-slate-900">{r.cycleTitle}</p>
                  <p className="text-slate-500">
                    السحب: {formatKwh(r.consumptionTenths)} ك.و
                    {showDiscount && r.discountKwhTenths > 0
                      ? ` • خصم: ${formatKwh(r.discountKwhTenths)} ك.و`
                      : ''}
                  </p>
                </div>
                <div className="text-left tabular-nums">
                  <p className="text-sm font-bold text-teal-800">
                    {formatCurrency(r.netAmountAgorot)} {settings.currency_symbol}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    تراكمي: {formatCurrency(r.cumulativeDueAfterCycleAgorot)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
