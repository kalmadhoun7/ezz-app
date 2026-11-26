import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureInitialData } from '../db/database';
import { addMeter } from '../db/meterService';
import { addUser, getUserFinancialSummary } from '../db/userService';
import { openNewCycle, getLastReadingForMeter } from '../db/cycleService';
import { addReading, detectMainMeterGap } from '../db/readingService';
import {
  applyPostCloseShift,
  computeCycleFinancialDiff,
  executeCloseCycle,
  reopenCycle,
} from '../db/closingEngine';
import { addPayment } from '../db/paymentService';
import { updateSettings } from '../db/settingsService';
import { getCycleOrDateRangeReport, getReadingRangeReport, buildInvoiceMessage } from '../db/reportService';
import { exportFullBackup, restoreFullBackup } from '../db/backupService';
import { distributeProportionally } from '../utils/math';

describe('SRS Section 6 — 7 Acceptance Criteria', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await ensureInitialData();
  });

  it('AC-1: Sub-meter sync (15.5 kWh) updates main 1500.0 -> 1515.5, no false gap, billed once', async () => {
    const mainId = (await db.meters.where('type').equals('MAIN').first())!.id!;
    const u1 = await addUser({ name: 'أحمد' });
    const subId = await addMeter({
      name: 'فرعي',
      type: 'SUB',
      parent_meter_id: mainId,
      default_user_id: u1,
    });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 15000,
    });

    await addReading({
      cycle_id: cycleId,
      meter_id: subId,
      user_id: u1,
      prev_reading_tenths: 2000,
      curr_reading_tenths: 2155,
      recorded_at: '2026-11-01T10:00:00.000Z',
    });

    expect(await getLastReadingForMeter(mainId, cycleId)).toBe(15155);
    expect(await detectMainMeterGap(cycleId, mainId, 15155)).toBeNull();

    const report = await getCycleOrDateRangeReport({ mainMeterId: mainId, cycleId });
    expect(report.rows.length).toBe(1);
    expect(report.rows[0].consumptionTenths).toBe(155); // 15.5 kWh counted ONCE
  });

  it('AC-2: Direct slot insertion for mid-cycle gaps without shifting others & no "فاقد" in reports', async () => {
    const mainId = (await db.meters.where('type').equals('MAIN').first())!.id!;
    const ahmed = await addUser({ name: 'أحمد' });
    const mohamed = await addUser({ name: 'محمد' });
    const ali = await addUser({ name: 'علي' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 15000,
    });

    // Ali 1500.0 -> 1510.0
    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: ali,
      prev_reading_tenths: 15000,
      curr_reading_tenths: 15100,
      recorded_at: '2026-11-01T10:00:00.000Z',
    });

    // Sunday Gap 1.2 kWh (1510.0 -> 1511.2), Ali continues 1511.2 -> 1530.0
    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: ali,
        prev_reading_tenths: 15112,
        curr_reading_tenths: 15300,
        recorded_at: '2026-11-02T10:00:00.000Z',
      },
      { mode: 'PENDING_GAP' }
    );

    // Wednesday Gap 0.5 kWh (1530.0 -> 1530.5), Ali continues 1530.5 -> 1540.0
    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: ali,
        prev_reading_tenths: 15305,
        curr_reading_tenths: 15400,
        recorded_at: '2026-11-05T10:00:00.000Z',
      },
      { mode: 'PENDING_GAP' }
    );

    const gaps = await db.pending_gaps.toArray();
    expect(gaps.length).toBe(2);

    await executeCloseCycle({
      cycleId,
      billPrevTenths: 15000,
      billCurrTenths: 15400,
      billKwhTenths: 400,
      billAmountAgorot: 40000,
      endDate: '2026-11-07T10:00:00.000Z',
      gapAssignments: {
        [gaps[0].id!]: ahmed,
        [gaps[1].id!]: mohamed,
      },
      userLossAllocations: {},
      unallocatedLossTenths: 0,
      userDiscountKwh: {},
    });

    const report = await getCycleOrDateRangeReport({ mainMeterId: mainId, cycleId });
    const ahmedRow = report.rows.find((r) => r.userId === ahmed)!;
    const mohamedRow = report.rows.find((r) => r.userId === mohamed)!;
    const aliRow = report.rows.find((r) => r.userId === ali)!;

    expect(ahmedRow.consumptionTenths).toBe(12);
    expect(mohamedRow.consumptionTenths).toBe(5);
    expect(aliRow.consumptionTenths).toBe(383); // 10.0 + 18.8 + 9.5 = 38.3 unchanged!

    // Ensure "فاقد" never appears in readings notes or generated invoice messages
    const settings = (await db.settings.get(1))!;
    for (const r of report.readings) {
      expect(r.notes).not.toContain('فاقد');
    }
    const msg = buildInvoiceMessage({
      row: ahmedRow,
      cycleTitle: 'الدورة 1',
      startDate: '2026-11-01T10:00:00.000Z',
      endDate: '2026-11-07T10:00:00.000Z',
      settings,
      mode: 'DETAILED',
      showDiscount: true,
    });
    expect(msg).not.toContain('فاقد');
  });

  it('AC-3: Chain shifting distributes 3.0 kWh loss across 2 of 5 users while keeping 3 users exact', async () => {
    const mainId = (await db.meters.where('type').equals('MAIN').first())!.id!;
    const u1 = await addUser({ name: 'م1' });
    const u2 = await addUser({ name: 'م2' });
    const u3 = await addUser({ name: 'م3' });
    const u4 = await addUser({ name: 'م4' });
    const u5 = await addUser({ name: 'م5' });

    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 10000,
    });

    await addReading({ cycle_id: cycleId, meter_id: mainId, user_id: u1, prev_reading_tenths: 10000, curr_reading_tenths: 10100, recorded_at: '2026-11-01T01:00:00.000Z' });
    await addReading({ cycle_id: cycleId, meter_id: mainId, user_id: u2, prev_reading_tenths: 10100, curr_reading_tenths: 10300, recorded_at: '2026-11-01T02:00:00.000Z' });
    await addReading({ cycle_id: cycleId, meter_id: mainId, user_id: u3, prev_reading_tenths: 10300, curr_reading_tenths: 10400, recorded_at: '2026-11-01T03:00:00.000Z' });
    await addReading({ cycle_id: cycleId, meter_id: mainId, user_id: u4, prev_reading_tenths: 10400, curr_reading_tenths: 10500, recorded_at: '2026-11-01T04:00:00.000Z' });
    await addReading({ cycle_id: cycleId, meter_id: mainId, user_id: u5, prev_reading_tenths: 10500, curr_reading_tenths: 10600, recorded_at: '2026-11-01T05:00:00.000Z' });

    // Bill closes at 1063.0 (3.0 kWh closing loss) distributed proportionally on u1 (10.0) and u2 (20.0)
    const shares = distributeProportionally(30, [
      { id: u1, weight: 100 },
      { id: u2, weight: 200 },
    ]);

    await executeCloseCycle({
      cycleId,
      billPrevTenths: 10000,
      billCurrTenths: 10630,
      billKwhTenths: 630,
      billAmountAgorot: 63000,
      endDate: '2026-11-07T10:00:00.000Z',
      gapAssignments: {},
      userLossAllocations: {
        [u1]: shares.get(u1)!,
        [u2]: shares.get(u2)!,
      },
      unallocatedLossTenths: 0,
      userDiscountKwh: {},
    });

    const finalReadings = await db.readings
      .where('cycle_id')
      .equals(cycleId)
      .sortBy('sequence_order');
    expect(finalReadings[finalReadings.length - 1].curr_reading_tenths).toBe(10630);
    // u3, u4, u5 remain exactly 10.0 kWh (100 tenths) each
    expect(finalReadings.find((r) => r.user_id === u3)!.consumption_tenths).toBe(100);
    expect(finalReadings.find((r) => r.user_id === u4)!.consumption_tenths).toBe(100);
    expect(finalReadings.find((r) => r.user_id === u5)!.consumption_tenths).toBe(100);
    expect(finalReadings.find((r) => r.user_id === u1)!.consumption_tenths).toBe(110);
    expect(finalReadings.find((r) => r.user_id === u2)!.consumption_tenths).toBe(220);
  });

  it('AC-4: Overflow straddling (1540.0->1555.0) splits at 1550.0 and carries over (1555.0->1560.0)', async () => {
    const mainId = (await db.meters.where('type').equals('MAIN').first())!.id!;
    const u1 = await addUser({ name: 'سالم' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 15400,
    });

    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: u1,
      prev_reading_tenths: 15400,
      curr_reading_tenths: 15550,
      recorded_at: '2026-11-06T10:00:00.000Z',
    });
    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: u1,
      prev_reading_tenths: 15550,
      curr_reading_tenths: 15600,
      recorded_at: '2026-11-06T18:00:00.000Z',
    });

    const { nextCycleId } = await executeCloseCycle({
      cycleId,
      billPrevTenths: 15400,
      billCurrTenths: 15500,
      billKwhTenths: 100,
      billAmountAgorot: 10000,
      endDate: '2026-11-06T12:00:00.000Z',
      gapAssignments: {},
      userLossAllocations: {},
      unallocatedLossTenths: 0,
      userDiscountKwh: {},
    });

    const curReadings = await db.readings.where('cycle_id').equals(cycleId).toArray();
    expect(curReadings.length).toBe(1);
    expect(curReadings[0].prev_reading_tenths).toBe(15400);
    expect(curReadings[0].curr_reading_tenths).toBe(15500);

    const nextReadings = await db.readings
      .where('cycle_id')
      .equals(nextCycleId)
      .sortBy('sequence_order');
    expect(nextReadings.length).toBe(2);
    expect(nextReadings[0].prev_reading_tenths).toBe(15500);
    expect(nextReadings[0].curr_reading_tenths).toBe(15550);
    expect(nextReadings[1].prev_reading_tenths).toBe(15550);
    expect(nextReadings[1].curr_reading_tenths).toBe(15600);

    // Also verify Mode 2 Reading Range query [1545.0, 1552.0] = 7.0 kWh
    const rangeRes = await getReadingRangeReport({
      mainMeterId: mainId,
      fromTenths: 15450,
      toTenths: 15520,
    });
    expect(rangeRes[0].consumptionTenths).toBe(70);
  });

  it('AC-5: Distributor discount (50.0 kWh @ 10 ILS = 500, bill 300 => 20.0 kWh discount) reduces ILS only', async () => {
    const mainId = (await db.meters.where('type').equals('MAIN').first())!.id!;
    const mohamed = await addUser({ name: 'محمد' });
    const other = await addUser({ name: 'آخر' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 10000,
      kwh_price_agorot: 1000,
    });

    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: mohamed,
      prev_reading_tenths: 10000,
      curr_reading_tenths: 10045, // 4.5 kWh
      recorded_at: '2026-11-01T10:00:00.000Z',
    });
    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: other,
      prev_reading_tenths: 10045,
      curr_reading_tenths: 10500, // 45.5 kWh
      recorded_at: '2026-11-02T10:00:00.000Z',
    });

    const diff = computeCycleFinancialDiff(500, 30000, 1000);
    expect(diff.discountKwhTenths).toBe(200); // 20.0 kWh

    await executeCloseCycle({
      cycleId,
      billPrevTenths: 10000,
      billCurrTenths: 10500,
      billKwhTenths: 500,
      billAmountAgorot: 30000,
      endDate: '2026-11-07T10:00:00.000Z',
      gapAssignments: {},
      userLossAllocations: {},
      unallocatedLossTenths: 0,
      userDiscountKwh: {
        [mohamed]: 15, // 1.5 kWh
        [other]: 185, // 18.5 kWh
      },
    });

    const report = await getCycleOrDateRangeReport({ mainMeterId: mainId, cycleId });
    const mRow = report.rows.find((r) => r.userId === mohamed)!;
    expect(mRow.consumptionTenths).toBe(45); // 4.5 kWh unchanged!
    expect(mRow.netAmountAgorot).toBe(3000); // (4.5 - 1.5) * 10 = 30.00 ILS
  });

  it('AC-6: Cumulative debt carryover (100 - 60 = 40) & non-retroactive price change (10 -> 12)', async () => {
    const mainId = (await db.meters.where('type').equals('MAIN').first())!.id!;
    const u1 = await addUser({ name: 'يوسف' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 10000,
      kwh_price_agorot: 1000, // 10 ILS
    });

    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: u1,
      prev_reading_tenths: 10000,
      curr_reading_tenths: 10100, // 10.0 kWh => 100 ILS
      recorded_at: '2026-11-01T10:00:00.000Z',
    });

    await executeCloseCycle({
      cycleId,
      billPrevTenths: 10000,
      billCurrTenths: 10100,
      billKwhTenths: 100,
      billAmountAgorot: 10000,
      endDate: '2026-11-07T10:00:00.000Z',
      gapAssignments: {},
      userLossAllocations: {},
      unallocatedLossTenths: 0,
      userDiscountKwh: {},
    });

    await addPayment({ user_id: u1, amount_agorot: 6000 }); // Paid 60 ILS
    expect((await getUserFinancialSummary(u1)).balanceDueAgorot).toBe(4000); // 40 ILS

    // Change default price from 10 to 12 ILS (non-retroactive)
    await updateSettings({ default_kwh_price_agorot: 1200 }, false);
    const oldCycle = await db.cycles.get(cycleId);
    expect(oldCycle?.kwh_price_agorot).toBe(1000);
    expect((await getUserFinancialSummary(u1)).balanceDueAgorot).toBe(4000);
  });

  it('AC-7: Reopen cycle restores PRE_CLOSE_ORIGINAL & JSON Backup/Restore preserves all tables', async () => {
    const mainId = (await db.meters.where('type').equals('MAIN').first())!.id!;
    const u1 = await addUser({ name: 'طارق' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 15000,
    });

    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: u1,
      prev_reading_tenths: 15000,
      curr_reading_tenths: 15100,
      recorded_at: '2026-11-01T10:00:00.000Z',
    });

    await executeCloseCycle({
      cycleId,
      billPrevTenths: 15000,
      billCurrTenths: 15120,
      billKwhTenths: 120,
      billAmountAgorot: 12000,
      endDate: '2026-11-07T10:00:00.000Z',
      gapAssignments: {},
      userLossAllocations: { [u1]: 20 },
      unallocatedLossTenths: 0,
      userDiscountKwh: {},
    });

    // Export backup before reopen
    const backup = await exportFullBackup();
    const backupJson = JSON.stringify(backup);

    // Reopen restores original reading (1500.0 -> 1510.0)
    await reopenCycle(cycleId);
    const reopenedCycle = await db.cycles.get(cycleId);
    expect(reopenedCycle?.status).toBe('OPEN');
    const restoredReadings = await db.readings.where('cycle_id').equals(cycleId).toArray();
    expect(restoredReadings.length).toBe(1);
    expect(restoredReadings[0].curr_reading_tenths).toBe(15100);

    // Clear DB and restore JSON backup
    await db.delete();
    await db.open();
    await restoreFullBackup(backupJson);
    const restoredClosedCycle = await db.cycles.get(cycleId);
    expect(restoredClosedCycle?.status).toBe('CLOSED');
    expect((await db.users.count())).toBe(1);
  });

  it('AC-8: kWh transfer (0.1 round-robin adjacent priority) & post-close shift', async () => {
    const mainId = (await db.meters.where('type').equals('MAIN').first())!.id!;
    const sourceU = await addUser({ name: 'عمارة الحرمين' });
    const recipU = await addUser({ name: 'الترتوري' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 10000,
      kwh_price_agorot: 1000,
    });

    // recipU has 3 readings: R1 (not adjacent), R2 (adjacent before source), R3 (not adjacent)
    await addReading({ cycle_id: cycleId, meter_id: mainId, user_id: recipU, prev_reading_tenths: 10000, curr_reading_tenths: 10010, recorded_at: '2026-11-21T01:00:00.000Z' });
    await addReading({ cycle_id: cycleId, meter_id: mainId, user_id: sourceU, prev_reading_tenths: 10010, curr_reading_tenths: 10050, recorded_at: '2026-11-21T02:00:00.000Z' });
    await addReading({ cycle_id: cycleId, meter_id: mainId, user_id: recipU, prev_reading_tenths: 10050, curr_reading_tenths: 10060, recorded_at: '2026-11-21T03:00:00.000Z' });

    // Close with FINANCIAL_ONLY transferring 0.2 kWh from sourceU to recipU
    await executeCloseCycle({
      cycleId,
      billPrevTenths: 10000,
      billCurrTenths: 10060,
      billKwhTenths: 60,
      billAmountAgorot: 6000,
      endDate: '2026-11-28T10:00:00.000Z',
      gapAssignments: {},
      userLossAllocations: {},
      unallocatedLossTenths: 0,
      kwhTransfer: {
        sourceUserId: sourceU,
        transfers: { [recipU]: 2 }, // 0.2 kWh
        mode: 'FINANCIAL_ONLY',
      },
      userDiscountKwh: {},
    });

    // Report shows combined kWh (recipU: 2.0 + 0.2 = 2.2, sourceU: 4.0 - 0.2 = 3.8)
    const rep = await getCycleOrDateRangeReport({ mainMeterId: mainId, cycleId });
    expect(rep.rows.find((r) => r.userId === recipU)!.consumptionTenths).toBe(22);
    expect(rep.rows.find((r) => r.userId === sourceU)!.consumptionTenths).toBe(38);

    // Readings were NOT shifted yet
    const preShiftReadings = await db.readings.where('cycle_id').equals(cycleId).sortBy('sequence_order');
    expect(preShiftReadings[1].consumption_tenths).toBe(40);

    // Now apply post-close shift
    await applyPostCloseShift(cycleId);
    const postShiftReadings = await db.readings.where('cycle_id').equals(cycleId).sortBy('sequence_order');
    expect(postShiftReadings[0].consumption_tenths).toBe(11); // +0.1
    expect(postShiftReadings[1].consumption_tenths).toBe(38); // -0.2
    expect(postShiftReadings[2].consumption_tenths).toBe(11); // +0.1
    expect(postShiftReadings[2].curr_reading_tenths).toBe(10060);
  });
});
