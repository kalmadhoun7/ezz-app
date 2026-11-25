import { db } from './database';
import { computeAmountAgorot } from '../utils/math';
import { formatCurrency, formatDateAr, formatKwh } from '../utils/format';
import type { Cycle, Reading, Settings, User } from '../types/models';

export interface UserCycleReportRow {
  userId: number;
  userName: string;
  whatsappPhone: string | null;
  consumptionTenths: number;
  discountKwhTenths: number;
  surchargeAgorot: number;
  netAmountAgorot: number;
  /** Cumulative balance across all closed cycles minus all payments */
  cumulativeBalanceAgorot: number;
}

export interface ReadingRangeReportRow {
  userId: number;
  userName: string;
  consumptionTenths: number;
  estimatedAmountAgorot: number;
}

export interface UserStatementRow {
  cycleId: number;
  cycleTitle: string;
  startDate: string;
  endDate: string | null;
  kwhPriceAgorot: number;
  consumptionTenths: number;
  discountKwhTenths: number;
  surchargeAgorot: number;
  netAmountAgorot: number;
  cumulativeDueAfterCycleAgorot: number;
}

/**
 * Mode 1: Report by Cycle ID (or Date Range on a Main Meter).
 * Counts ONLY MAIN meter readings so sub-meters are never double-billed.
 */
export async function getCycleOrDateRangeReport(params: {
  mainMeterId: number;
  cycleId?: number;
  fromDate?: string;
  toDate?: string;
}): Promise<{
  rows: UserCycleReportRow[];
  readings: Reading[];
  cycle?: Cycle;
}> {
  const [users, cycles, allReadings, adjustments, payments] = await Promise.all([
    db.users.toArray(),
    db.cycles.where('meter_id').equals(params.mainMeterId).toArray(),
    db.readings.where('meter_id').equals(params.mainMeterId).toArray(),
    db.cycle_user_adjustments.toArray(),
    db.payments.toArray(),
  ]);

  const userMap = new Map(users.map((u) => [u.id!, u]));
  const cycleMap = new Map(cycles.map((c) => [c.id!, c]));

  let targetReadings = allReadings;
  let selectedCycle: Cycle | undefined;

  if (params.cycleId !== undefined) {
    selectedCycle = cycleMap.get(params.cycleId);
    targetReadings = allReadings.filter((r) => r.cycle_id === params.cycleId);
  } else {
    if (params.fromDate) {
      targetReadings = targetReadings.filter((r) => r.recorded_at >= params.fromDate!);
    }
    if (params.toDate) {
      targetReadings = targetReadings.filter((r) => r.recorded_at <= params.toDate!);
    }
  }

  targetReadings.sort(
    (a, b) => a.sequence_order - b.sequence_order || (a.id ?? 0) - (b.id ?? 0)
  );

  // Aggregate per user for selected scope
  const agg = new Map<
    number,
    { consumptionTenths: number; netAmountAgorot: number; discountTenths: number; surchargeAgorot: number }
  >();

  // Group by user & cycle to apply cycle rate & adjustments accurately
  const byUserCycle = new Map<string, number>();
  for (const r of targetReadings) {
    const key = `${r.user_id}:${r.cycle_id}`;
    byUserCycle.set(key, (byUserCycle.get(key) ?? 0) + r.consumption_tenths);
  }

  const adjMap = new Map(adjustments.map((a) => [`${a.user_id}:${a.cycle_id}`, a]));

  for (const [key, kwh] of byUserCycle.entries()) {
    const [uidStr, cidStr] = key.split(':');
    const uid = Number(uidStr);
    const cid = Number(cidStr);
    const cyc = cycleMap.get(cid);
    const rate = cyc?.kwh_price_agorot ?? 0;
    const adj = adjMap.get(key);
    const disc = adj?.discount_kwh_tenths ?? 0;
    const sur = adj?.surcharge_agorot ?? 0;
    const netKwh = Math.max(0, kwh - disc);
    const amount = computeAmountAgorot(netKwh, rate) + sur;

    const prev = agg.get(uid) ?? {
      consumptionTenths: 0,
      netAmountAgorot: 0,
      discountTenths: 0,
      surchargeAgorot: 0,
    };
    prev.consumptionTenths += kwh;
    prev.netAmountAgorot += amount;
    prev.discountTenths += disc;
    prev.surchargeAgorot += sur;
    agg.set(uid, prev);
  }

  // Also include users who had an adjustment in the selected cycle even if 0 readings
  if (params.cycleId !== undefined) {
    for (const adj of adjustments) {
      if (adj.cycle_id === params.cycleId && !agg.has(adj.user_id)) {
        agg.set(adj.user_id, {
          consumptionTenths: 0,
          netAmountAgorot: adj.surcharge_agorot,
          discountTenths: adj.discount_kwh_tenths,
          surchargeAgorot: adj.surcharge_agorot,
        });
      }
    }
  }

  // Compute cumulative closed-cycle balance per user
  const closedCycleIds = new Set(
    cycles.filter((c) => c.status === 'CLOSED').map((c) => c.id!)
  );
  const closedDueByUser = new Map<number, number>();
  for (const r of allReadings) {
    if (!closedCycleIds.has(r.cycle_id)) continue;
    const cyc = cycleMap.get(r.cycle_id)!;
    closedDueByUser.set(
      r.user_id,
      (closedDueByUser.get(r.user_id) ?? 0) +
        computeAmountAgorot(r.consumption_tenths, cyc.kwh_price_agorot)
    );
  }
  for (const adj of adjustments) {
    if (!closedCycleIds.has(adj.cycle_id)) continue;
    const cyc = cycleMap.get(adj.cycle_id)!;
    const discValue = computeAmountAgorot(adj.discount_kwh_tenths, cyc.kwh_price_agorot);
    closedDueByUser.set(
      adj.user_id,
      (closedDueByUser.get(adj.user_id) ?? 0) - discValue + adj.surcharge_agorot
    );
  }

  const paidByUser = new Map<number, number>();
  for (const p of payments) {
    paidByUser.set(p.user_id, (paidByUser.get(p.user_id) ?? 0) + p.amount_agorot);
  }

  const rows: UserCycleReportRow[] = [];
  for (const [uid, data] of agg.entries()) {
    const u = userMap.get(uid);
    if (!u) continue;
    const cumBalance = (closedDueByUser.get(uid) ?? 0) - (paidByUser.get(uid) ?? 0);
    rows.push({
      userId: uid,
      userName: u.name,
      whatsappPhone: u.whatsapp_phone,
      consumptionTenths: data.consumptionTenths,
      discountKwhTenths: data.discountTenths,
      surchargeAgorot: data.surchargeAgorot,
      netAmountAgorot: data.netAmountAgorot,
      cumulativeBalanceAgorot: cumBalance,
    });
  }

  rows.sort((a, b) => a.userName.localeCompare(b.userName, 'ar'));
  return { rows, readings: targetReadings, cycle: selectedCycle };
}

/**
 * Mode 2: Query by Meter Reading Range [fromTenths, toTenths].
 * Prorates straddling readings cleanly to the overlapping interval.
 */
export async function getReadingRangeReport(params: {
  mainMeterId: number;
  fromTenths: number;
  toTenths: number;
}): Promise<ReadingRangeReportRow[]> {
  if (params.toTenths <= params.fromTenths) return [];

  const [users, cycles, readings] = await Promise.all([
    db.users.toArray(),
    db.cycles.where('meter_id').equals(params.mainMeterId).toArray(),
    db.readings.where('meter_id').equals(params.mainMeterId).toArray(),
  ]);

  const userMap = new Map(users.map((u) => [u.id!, u]));
  const cycleMap = new Map(cycles.map((c) => [c.id!, c]));
  const agg = new Map<number, { kwh: number; amount: number }>();

  for (const r of readings) {
    const overlapStart = Math.max(r.prev_reading_tenths, params.fromTenths);
    const overlapEnd = Math.min(r.curr_reading_tenths, params.toTenths);
    if (overlapEnd > overlapStart) {
      const sliceKwh = overlapEnd - overlapStart;
      const rate = cycleMap.get(r.cycle_id)?.kwh_price_agorot ?? 0;
      const sliceAmount = computeAmountAgorot(sliceKwh, rate);

      const prev = agg.get(r.user_id) ?? { kwh: 0, amount: 0 };
      prev.kwh += sliceKwh;
      prev.amount += sliceAmount;
      agg.set(r.user_id, prev);
    }
  }

  const rows: ReadingRangeReportRow[] = [];
  for (const [uid, data] of agg.entries()) {
    const u = userMap.get(uid);
    if (!u) continue;
    rows.push({
      userId: uid,
      userName: u.name,
      consumptionTenths: data.kwh,
      estimatedAmountAgorot: data.amount,
    });
  }
  return rows.sort((a, b) => a.userName.localeCompare(b.userName, 'ar'));
}

/**
 * Mode 3: Full User Statement across all cycles.
 */
export async function getUserFullStatement(userId: number): Promise<{
  user: User | undefined;
  rows: UserStatementRow[];
  totalPaidAgorot: number;
  finalBalanceAgorot: number;
}> {
  const [user, cycles, meters, readings, adjustments, payments] = await Promise.all([
    db.users.get(userId),
    db.cycles.toArray(),
    db.meters.toArray(),
    db.readings.where('user_id').equals(userId).toArray(),
    db.cycle_user_adjustments.where('user_id').equals(userId).toArray(),
    db.payments.where('user_id').equals(userId).toArray(),
  ]);

  const mainMeterIds = new Set(meters.filter((m) => m.type === 'MAIN').map((m) => m.id!));
  const adjByCycle = new Map(adjustments.map((a) => [a.cycle_id, a]));
  const sortedCycles = [...cycles].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  const rows: UserStatementRow[] = [];
  let runningDue = 0;

  for (const c of sortedCycles) {
    const cycReadings = readings.filter(
      (r) => r.cycle_id === c.id && mainMeterIds.has(r.meter_id)
    );
    const kwh = cycReadings.reduce((s, r) => s + r.consumption_tenths, 0);
    const adj = adjByCycle.get(c.id!);
    const disc = adj?.discount_kwh_tenths ?? 0;
    const sur = adj?.surcharge_agorot ?? 0;

    if (kwh === 0 && disc === 0 && sur === 0) continue;

    const netKwh = Math.max(0, kwh - disc);
    const netAmount = computeAmountAgorot(netKwh, c.kwh_price_agorot) + sur;
    if (c.status === 'CLOSED') {
      runningDue += netAmount;
    }

    rows.push({
      cycleId: c.id!,
      cycleTitle: c.title,
      startDate: c.start_date,
      endDate: c.end_date,
      kwhPriceAgorot: c.kwh_price_agorot,
      consumptionTenths: kwh,
      discountKwhTenths: disc,
      surchargeAgorot: sur,
      netAmountAgorot: netAmount,
      cumulativeDueAfterCycleAgorot: runningDue,
    });
  }

  const totalPaidAgorot = payments.reduce((s, p) => s + p.amount_agorot, 0);
  const finalBalanceAgorot = runningDue - totalPaidAgorot;

  return { user, rows, totalPaidAgorot, finalBalanceAgorot };
}

/**
 * Builds a clean WhatsApp/Share message (Compact or Detailed + optional discount toggle).
 * Never mentions "فاقد".
 */
export function buildInvoiceMessage(params: {
  row: UserCycleReportRow;
  cycleTitle: string;
  startDate: string;
  endDate: string | null;
  isCycleClosed?: boolean;
  settings: Settings;
  mode: 'COMPACT' | 'DETAILED';
  showDiscount: boolean;
}): string {
  const {
    row,
    cycleTitle,
    startDate,
    endDate,
    isCycleClosed = true,
    settings,
    mode,
    showDiscount,
  } = params;
  const cur = settings.currency_symbol;
  const titleHasDate = /\d{1,2}\/\d{1,2}\/\d{4}/.test(cycleTitle);
  const period = endDate
    ? `${formatDateAr(startDate)} - ${formatDateAr(endDate)}`
    : `من ${formatDateAr(startDate)}`;

  const lines: string[] = [
    `فاتورة الكهرباء — ${row.userName}`,
    titleHasDate ? cycleTitle : `${cycleTitle} (${period})`,
  ];

  if (mode === 'DETAILED') {
    lines.push(`كمية السحب: ${formatKwh(row.consumptionTenths)} ك.و`);
    if (showDiscount && row.discountKwhTenths > 0) {
      lines.push(`خصم مطبق: ${formatKwh(row.discountKwhTenths)} ك.و`);
    }
  }

  lines.push(`المستحق للدورة: ${formatCurrency(row.netAmountAgorot)} ${cur}`);

  const prevCarry = isCycleClosed
    ? row.cumulativeBalanceAgorot - row.netAmountAgorot
    : row.cumulativeBalanceAgorot;
  const totalDue = prevCarry + row.netAmountAgorot;

  if (prevCarry !== 0) {
    lines.push(
      prevCarry > 0
        ? `مبلغ سابق مرحّل: ${formatCurrency(prevCarry)} ${cur}`
        : `رصيد دائن سابق: ${formatCurrency(Math.abs(prevCarry))} ${cur}`
    );
    lines.push(`الإجمالي المطلوب: ${formatCurrency(totalDue)} ${cur}`);
  }

  return lines.join('\n');
}
