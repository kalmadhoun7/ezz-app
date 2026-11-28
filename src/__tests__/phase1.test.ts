import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureInitialData } from '../db/database';
import { addMeter } from '../db/meterService';
import { addUser } from '../db/userService';
import { openNewCycle, getLastReadingForMeter } from '../db/cycleService';
import {
  addReading,
  deleteReading,
  detectMainMeterGap,
  detectMainMeterOverlap,
  updateReading,
} from '../db/readingService';
import { normalizeDigits, sanitizeDecimalInput } from '../utils/digits';
import {
  agorotToKwhTenths,
  computeAmountAgorot,
  distributeProportionally,
  parseCurrencyToAgorot,
  parseKwhToTenths,
} from '../utils/math';

describe('Phase 1 — Core Math, Digits & Data Layer', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await ensureInitialData();
  });

  it('converts Arabic-Indic digits and avoids floating-point errors', () => {
    expect(normalizeDigits('١٥٢٠٫٥')).toBe('1520.5');
    expect(sanitizeDecimalInput('٠١٢٫٣٤', 1)).toBe('012.3');
    expect(parseKwhToTenths('١٥٢٠.٥')).toBe(15205);
    expect(parseKwhToTenths('0.1')! + parseKwhToTenths('0.2')!).toBe(3); // 0.3 kWh exact
    expect(parseCurrencyToAgorot('10.50')).toBe(1050);
    expect(computeAmountAgorot(155, 1000)).toBe(15500); // 15.5 * 10.00 = 155.00
    expect(agorotToKwhTenths(20000, 1000)).toBe(200); // 200 ILS / 10 = 20.0 kWh
  });

  it('distributes remainders using Largest Remainder Method with 0 remainder', () => {
    const shares = distributeProportionally(30, [
      { id: 1, weight: 10 },
      { id: 2, weight: 15 },
      { id: 3, weight: 20 },
    ]);
    const sum = (shares.get(1) ?? 0) + (shares.get(2) ?? 0) + (shares.get(3) ?? 0);
    expect(sum).toBe(30);
  });

  it('syncs sub-meter reading atomically with main meter without double billing', async () => {
    const mainMeters = await db.meters.where('type').equals('MAIN').toArray();
    const mainId = mainMeters[0].id!;
    const userId = await addUser({ name: 'أحمد' });
    const subId = await addMeter({
      name: 'فرعي 1',
      type: 'SUB',
      parent_meter_id: mainId,
      default_user_id: userId,
    });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 15000, // 1500.0
    });

    const res = await addReading({
      cycle_id: cycleId,
      meter_id: subId,
      user_id: userId,
      prev_reading_tenths: 2000, // 200.0
      curr_reading_tenths: 2155, // 215.5 (delta 15.5)
      recorded_at: new Date().toISOString(),
    });

    expect(res.linkedMainReadingId).toBeDefined();
    const lastMain = await getLastReadingForMeter(mainId, cycleId);
    expect(lastMain).toBe(15155); // 1515.5

    // No gap when next main reading starts at 1515.5
    const gap = await detectMainMeterGap(cycleId, mainId, 15155);
    expect(gap).toBeNull();

    // Editing sub reading updates linked main reading
    await updateReading(res.readingId, {
      user_id: userId,
      prev_reading_tenths: 2000,
      curr_reading_tenths: 2200, // delta 20.0
      recorded_at: new Date().toISOString(),
      notes: 'تعديل',
    });
    const updatedMain = await db.readings.get(res.linkedMainReadingId!);
    expect(updatedMain?.consumption_tenths).toBe(200);
    expect(updatedMain?.curr_reading_tenths).toBe(15200);

    // Deleting sub reading deletes linked main reading
    await deleteReading(res.readingId);
    expect(await db.readings.count()).toBe(0);
  });

  it('detects gaps on main meter and supports PendingGap or immediate assignment', async () => {
    const mainMeters = await db.meters.where('type').equals('MAIN').toArray();
    const mainId = mainMeters[0].id!;
    const u1 = await addUser({ name: 'سعيد' });
    const u2 = await addUser({ name: 'خالد' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 15000,
    });

    const gap = await detectMainMeterGap(cycleId, mainId, 15012);
    expect(gap).toEqual({ lastRecordedTenths: 15000, gapTenths: 12 });

    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: u1,
        prev_reading_tenths: 15012,
        curr_reading_tenths: 15050,
        recorded_at: new Date().toISOString(),
      },
      { mode: 'PENDING_GAP' }
    );
    expect(await db.pending_gaps.count()).toBe(1);

    // Another gap assigned immediately to u2
    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: u1,
        prev_reading_tenths: 15060,
        curr_reading_tenths: 15100,
        recorded_at: new Date().toISOString(),
      },
      { mode: 'ASSIGN_TO_USER', gap_user_id: u2 }
    );
    const mainReadings = await db.readings.toArray();
    expect(mainReadings.length).toBe(3); // u1(1501.2->1505.0), u2(1505.0->1506.0), u1(1506.0->1510.0)
  });

  it('detects overlapping/backdated readings, shifts subsequent readings preserving consumption, and tracks max meter reading', async () => {
    const mainMeters = await db.meters.where('type').equals('MAIN').toArray();
    const mainId = mainMeters[0].id!;
    const haramain = await addUser({ name: 'عمارة الحرمين' });
    const abuAlAbed = await addUser({ name: 'أبو العبد مهنا' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 16216, // 1621.6
    });

    // عمارة الحرمين: 1621.6 -> 1625.1 (3.5 kWh)
    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: haramain,
      prev_reading_tenths: 16216,
      curr_reading_tenths: 16251,
      recorded_at: '2026-11-20T10:00:00.000Z',
    });

    // Overlap detected when entering 1621.6 -> 1622.4 (0.8 kWh)
    const overlap = await detectMainMeterOverlap(cycleId, mainId, 16216, 16224);
    expect(overlap?.overlappingReadings.length).toBe(1);
    expect(overlap?.affectedCount).toBe(1);
    expect(overlap?.nextCandidate?.curr).toBe(16251);

    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: abuAlAbed,
        prev_reading_tenths: 16216,
        curr_reading_tenths: 16224,
        recorded_at: '2026-11-19T10:00:00.000Z',
      },
      { mode: 'NONE' },
      'INSERT_AND_SHIFT'
    );

    const all = await db.readings.where('cycle_id').equals(cycleId).sortBy('sequence_order');
    expect(all.length).toBe(2);
    expect(all[0].user_id).toBe(abuAlAbed);
    expect(all[0].prev_reading_tenths).toBe(16216);
    expect(all[0].curr_reading_tenths).toBe(16224);
    expect(all[0].consumption_tenths).toBe(8);

    // عمارة الحرمين shifted to 1622.4 -> 1625.9 with consumption 3.5 preserved
    expect(all[1].user_id).toBe(haramain);
    expect(all[1].prev_reading_tenths).toBe(16224);
    expect(all[1].curr_reading_tenths).toBe(16259);
    expect(all[1].consumption_tenths).toBe(35);

    // Adding an earlier reading in an empty slot (1618.2 -> 1618.3) must NOT trigger overlap
    expect(await detectMainMeterOverlap(cycleId, mainId, 16182, 16183)).toBeNull();

    // Adding an earlier backdated reading (1618.2 -> 1618.3)
    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: abuAlAbed,
        prev_reading_tenths: 16182,
        curr_reading_tenths: 16183,
        recorded_at: '2026-11-14T10:00:00.000Z',
      },
      { mode: 'NONE' },
      'KEEP_AS_IS'
    );

    // Highest reading on meter must still be 1625.9, NOT 1618.3!
    expect(await getLastReadingForMeter(mainId, cycleId)).toBe(16259);
  });

  it('supports deducting overlap from next or previous reading without shifting others', async () => {
    const mainMeters = await db.meters.where('type').equals('MAIN').toArray();
    const mainId = mainMeters[0].id!;
    const haramain = await addUser({ name: 'عمارة الحرمين' });
    const abuAlAbed = await addUser({ name: 'أبو العبد' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 16216,
    });

    // عمارة الحرمين: 1621.6 -> 1625.1 (3.5 kWh)
    await addReading({
      cycle_id: cycleId,
      meter_id: mainId,
      user_id: haramain,
      prev_reading_tenths: 16216,
      curr_reading_tenths: 16251,
      recorded_at: '2026-11-20T10:00:00.000Z',
    });

    // Insert أبو العبد 1621.6 -> 1622.4 (0.8 kWh) and DEDUCT_FROM_NEXT
    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: abuAlAbed,
        prev_reading_tenths: 16216,
        curr_reading_tenths: 16224,
        recorded_at: '2026-11-19T10:00:00.000Z',
      },
      { mode: 'NONE' },
      'DEDUCT_FROM_NEXT'
    );

    const afterDeductNext = await db.readings
      .where('cycle_id')
      .equals(cycleId)
      .sortBy('sequence_order');
    expect(afterDeductNext[0].consumption_tenths).toBe(8); // 0.8 kWh
    expect(afterDeductNext[1].prev_reading_tenths).toBe(16224);
    expect(afterDeductNext[1].curr_reading_tenths).toBe(16251);
    expect(afterDeductNext[1].consumption_tenths).toBe(27); // 3.5 - 0.8 = 2.7 kWh
  });

  it('auto-reconciles PENDING gaps when a new reading partially or fully covers the gap range', async () => {
    const mainMeters = await db.meters.where('type').equals('MAIN').toArray();
    const mainId = mainMeters[0].id!;
    const u1 = await addUser({ name: 'مستخدم 1' });
    const cycleId = await openNewCycle({
      meter_id: mainId,
      opening_reading_tenths: 16924, // 1692.4
    });

    // Create a 3.0 kWh pending gap (1692.4 -> 1695.4)
    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: u1,
        prev_reading_tenths: 16954,
        curr_reading_tenths: 16960,
        recorded_at: '2026-11-27T13:42:00.000Z',
      },
      { mode: 'PENDING_GAP' }
    );
    expect((await db.pending_gaps.where('status').equals('PENDING').count())).toBe(1);

    // Add a reading covering 1.0 kWh of the gap (1692.4 -> 1693.4)
    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: u1,
        prev_reading_tenths: 16924,
        curr_reading_tenths: 16934,
        recorded_at: '2026-11-27T14:00:00.000Z',
      },
      { mode: 'NONE' },
      'KEEP_AS_IS'
    );

    const remainingGaps = await db.pending_gaps.where('status').equals('PENDING').toArray();
    expect(remainingGaps.length).toBe(1);
    expect(remainingGaps[0].from_reading_tenths).toBe(16934);
    expect(remainingGaps[0].to_reading_tenths).toBe(16954);
    expect(remainingGaps[0].gap_tenths).toBe(20); // 2.0 kWh left

    // Add a reading covering the remaining 2.0 kWh (1693.4 -> 1695.4)
    await addReading(
      {
        cycle_id: cycleId,
        meter_id: mainId,
        user_id: u1,
        prev_reading_tenths: 16934,
        curr_reading_tenths: 16954,
        recorded_at: '2026-11-27T14:10:00.000Z',
      },
      { mode: 'NONE' },
      'KEEP_AS_IS'
    );

    expect((await db.pending_gaps.where('status').equals('PENDING').count())).toBe(0);
  });
});
