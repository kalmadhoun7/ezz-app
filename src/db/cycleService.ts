import { db } from './database';
import { getSettings } from './settingsService';
import { formatDateSlash } from '../utils/format';
import type { Cycle } from '../types/models';

export async function getOpenCycleForMeter(mainMeterId: number): Promise<Cycle | undefined> {
  const cycles = await db.cycles.where('meter_id').equals(mainMeterId).toArray();
  return cycles.find((c) => c.status === 'OPEN');
}

export async function getCyclesForMeter(mainMeterId: number): Promise<Cycle[]> {
  const cycles = await db.cycles.where('meter_id').equals(mainMeterId).toArray();
  return cycles.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
}

export async function updateCycleTitle(cycleId: number, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('اسم الدورة لا يمكن أن يكون فارغاً');
  await db.cycles.update(cycleId, { title: trimmed });
}

export async function getSuggestedOpeningReading(mainMeterId: number): Promise<number> {
  const cycles = await getCyclesForMeter(mainMeterId);
  const lastClosed = cycles.find((c) => c.status === 'CLOSED' && c.closing_reading_tenths !== null);
  return lastClosed?.closing_reading_tenths ?? 0;
}

export async function openNewCycle(input: {
  meter_id: number;
  title?: string;
  start_date?: string;
  opening_reading_tenths: number;
  kwh_price_agorot?: number;
}): Promise<number> {
  return db.transaction('rw', [db.cycles, db.settings, db.meters], async () => {
    const meter = await db.meters.get(input.meter_id);
    if (!meter || meter.type !== 'MAIN') {
      throw new Error('يجب اختيار عداد رئيسي صالح لفتح الدورة');
    }

    const existingOpen = await getOpenCycleForMeter(input.meter_id);
    if (existingOpen) {
      throw new Error('توجد دورة مفتوحة بالفعل لهذا العداد الرئيسي. يجب إقفالها أولاً.');
    }

    const settings = await getSettings();
    const startDate = input.start_date || new Date().toISOString();
    const title = input.title?.trim() || `دورة "${formatDateSlash(startDate)}"`;
    const price = input.kwh_price_agorot ?? settings.default_kwh_price_agorot;

    const id = await db.cycles.add({
      meter_id: input.meter_id,
      title,
      start_date: startDate,
      end_date: null,
      opening_reading_tenths: input.opening_reading_tenths,
      closing_reading_tenths: null,
      kwh_price_agorot: price,
      status: 'OPEN',
      bill_prev_tenths: null,
      bill_curr_tenths: null,
      bill_kwh_tenths: null,
      bill_amount_agorot: null,
      unallocated_loss_tenths: 0,
      surcharge_agorot: 0,
      closed_at: null,
    });

    return id as number;
  });
}

/**
 * Returns the last recorded reading (curr_reading_tenths) on a meter.
 * For MAIN meter: checks readings in the given cycle; falls back to cycle opening_reading_tenths.
 * For SUB meter: checks the latest reading across all cycles for that sub-meter (or 0 if none).
 */
export async function getLastReadingForMeter(
  meterId: number,
  cycleId?: number
): Promise<number> {
  const meter = await db.meters.get(meterId);
  if (!meter) return 0;

  if (meter.type === 'MAIN' && cycleId !== undefined) {
    const cycle = await db.cycles.get(cycleId);
    const readings = await db.readings
      .where('cycle_id')
      .equals(cycleId)
      .filter((r) => r.meter_id === meterId)
      .toArray();
    const opening = cycle?.opening_reading_tenths ?? 0;
    if (readings.length === 0) {
      return opening;
    }
    return Math.max(opening, ...readings.map((r) => r.curr_reading_tenths));
  }

  // SUB meter (or MAIN without cycleId)
  const readings = await db.readings.where('meter_id').equals(meterId).toArray();
  if (readings.length === 0) return 0;
  readings.sort((a, b) => {
    const t = a.recorded_at.localeCompare(b.recorded_at);
    return t !== 0 ? t : (a.id ?? 0) - (b.id ?? 0);
  });
  return readings[readings.length - 1].curr_reading_tenths;
}
