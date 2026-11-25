import { db } from './database';
import { getSettings } from './settingsService';
import { agorotToKwhTenths, computeAmountAgorot } from '../utils/math';
import { formatDateSlash } from '../utils/format';
import type {
  CycleSnapshotPayload,
  Reading,
} from '../types/models';

export interface OverflowAnalysis {
  fullyAfter: Reading[];
  straddling: Reading[];
  inCycleReadings: Reading[];
  lastInCycleCurrTenths: number;
}

export interface CycleDiscrepancyItem {
  key: string;
  kind: 'PENDING_GAP' | 'INTERNAL_GAP' | 'CLOSING_GAP' | 'OVERLAP';
  fromTenths: number;
  toTenths: number;
  amountTenths: number; // positive for gap, positive magnitude for overlap
  pendingGapId?: number;
  prevUserId?: number;
  nextUserId?: number;
  detectedAt?: string;
}

export interface CycleDiscrepancyReport {
  billKwhTenths: number;
  recordedKwhTenths: number;
  netLossTenths: number;
  items: CycleDiscrepancyItem[];
}

/**
 * Scans all in-cycle main readings (including any straddling part 1) against
 * [billPrevTenths, billCurrTenths] to surface every gap (opening, between users,
 * pending, closing) and any overlap between consecutive users' readings.
 */
export function analyzeCycleDiscrepancies(
  inCycleReadings: Reading[],
  straddlingReadings: Reading[],
  pendingGaps: { id?: number; from_reading_tenths: number; to_reading_tenths: number; gap_tenths: number; detected_at: string; status: string }[],
  billPrevTenths: number,
  billCurrTenths: number
): CycleDiscrepancyReport {
  const effective: Reading[] = [
    ...inCycleReadings.map((r) => ({ ...r })),
    ...straddlingReadings.map((r) => ({
      ...r,
      curr_reading_tenths: billCurrTenths,
      consumption_tenths: Math.max(0, billCurrTenths - r.prev_reading_tenths),
    })),
  ].sort(
    (a, b) =>
      a.prev_reading_tenths - b.prev_reading_tenths ||
      a.curr_reading_tenths - b.curr_reading_tenths ||
      (a.id ?? 0) - (b.id ?? 0)
  );

  const items: CycleDiscrepancyItem[] = [];
  const activePending = pendingGaps.filter((g) => g.status === 'PENDING');
  const matchedPendingIds = new Set<number>();

  const findMatchingPending = (from: number, to: number) =>
    activePending.find(
      (g) =>
        !matchedPendingIds.has(g.id!) &&
        g.from_reading_tenths === from &&
        g.to_reading_tenths === to
    );

  let cursor = billPrevTenths;
  let prevUserId: number | undefined;

  for (const r of effective) {
    if (r.prev_reading_tenths > cursor) {
      const pending = findMatchingPending(cursor, r.prev_reading_tenths);
      if (pending) {
        matchedPendingIds.add(pending.id!);
        items.push({
          key: `pending-${pending.id}`,
          kind: 'PENDING_GAP',
          fromTenths: pending.from_reading_tenths,
          toTenths: pending.to_reading_tenths,
          amountTenths: pending.gap_tenths,
          pendingGapId: pending.id,
          prevUserId,
          nextUserId: r.user_id,
          detectedAt: pending.detected_at,
        });
      } else {
        items.push({
          key: `gap-${cursor}-${r.prev_reading_tenths}`,
          kind: 'INTERNAL_GAP',
          fromTenths: cursor,
          toTenths: r.prev_reading_tenths,
          amountTenths: r.prev_reading_tenths - cursor,
          prevUserId,
          nextUserId: r.user_id,
          detectedAt: r.recorded_at,
        });
      }
    } else if (r.prev_reading_tenths < cursor) {
      const overlapEnd = Math.min(cursor, r.curr_reading_tenths);
      items.push({
        key: `overlap-${r.prev_reading_tenths}-${overlapEnd}-${r.id ?? ''}`,
        kind: 'OVERLAP',
        fromTenths: r.prev_reading_tenths,
        toTenths: overlapEnd,
        amountTenths: overlapEnd - r.prev_reading_tenths,
        prevUserId,
        nextUserId: r.user_id,
      });
    }

    if (r.curr_reading_tenths > cursor) {
      cursor = r.curr_reading_tenths;
      prevUserId = r.user_id;
    }
  }

  // Include any remaining unmatched pending gaps
  for (const g of activePending) {
    if (!matchedPendingIds.has(g.id!)) {
      items.push({
        key: `pending-${g.id}`,
        kind: 'PENDING_GAP',
        fromTenths: g.from_reading_tenths,
        toTenths: g.to_reading_tenths,
        amountTenths: g.gap_tenths,
        pendingGapId: g.id,
        detectedAt: g.detected_at,
      });
    }
  }

  if (billCurrTenths > cursor) {
    items.push({
      key: `closing-${cursor}-${billCurrTenths}`,
      kind: 'CLOSING_GAP',
      fromTenths: cursor,
      toTenths: billCurrTenths,
      amountTenths: billCurrTenths - cursor,
      prevUserId,
    });
  }

  const billKwhTenths = Math.max(0, billCurrTenths - billPrevTenths);
  const recordedKwhTenths = effective.reduce(
    (s, r) => s + r.consumption_tenths,
    0
  );
  const netLossTenths = Math.max(0, billKwhTenths - recordedKwhTenths);

  return {
    billKwhTenths,
    recordedKwhTenths,
    netLossTenths,
    items,
  };
}

/**
 * Step 1 helper: Inspects main-meter readings in the cycle against `billCurrTenths`
 * to detect readings that straddle or fall completely after the distributor bill cutoff.
 */
export function analyzeOverflowReadings(
  readings: Reading[],
  openingReadingTenths: number,
  billCurrTenths: number
): OverflowAnalysis {
  const sorted = [...readings].sort(
    (a, b) => a.sequence_order - b.sequence_order || (a.id ?? 0) - (b.id ?? 0)
  );

  const fullyAfter: Reading[] = [];
  const straddling: Reading[] = [];
  const inCycleReadings: Reading[] = [];

  for (const r of sorted) {
    if (r.prev_reading_tenths >= billCurrTenths) {
      fullyAfter.push(r);
    } else if (
      r.prev_reading_tenths < billCurrTenths &&
      r.curr_reading_tenths > billCurrTenths
    ) {
      straddling.push(r);
    } else {
      inCycleReadings.push(r);
    }
  }

  let lastInCycleCurrTenths = openingReadingTenths;
  if (straddling.length > 0) {
    lastInCycleCurrTenths = billCurrTenths;
  } else if (inCycleReadings.length > 0) {
    lastInCycleCurrTenths =
      inCycleReadings[inCycleReadings.length - 1].curr_reading_tenths;
  }

  return {
    fullyAfter,
    straddling,
    inCycleReadings,
    lastInCycleCurrTenths,
  };
}

export interface CloseCycleInput {
  cycleId: number;
  billPrevTenths: number;
  billCurrTenths: number;
  billKwhTenths: number;
  billAmountAgorot: number;
  endDate: string;
  /** Step 2: Direct gap -> user assignments (Priority 1: Direct Slot Insertion) */
  gapAssignments: Record<number, number>; // gapId -> userId
  /** Step 2: Internal/closing gap direct slot assignments */
  slotGapAssignments?: {
    fromTenths: number;
    toTenths: number;
    userId: number;
    detectedAt?: string;
  }[];
  /** Step 2: Additional distributed loss per user (Priority 2: Local Adjustment + Chain Shifting) */
  userLossAllocations: Record<number, number>; // userId -> tenths
  /** Step 2: Remaining unallocated loss kept as independent cycle item */
  unallocatedLossTenths: number;
  /** Step 4: Discount kWh allocations per user (tenths) */
  userDiscountKwh: Record<number, number>;
  /** Step 4: Surcharge mode if billAmount > expected */
  surchargeMode?: 'NONE' | 'RECALCULATE_RATE' | 'DISTRIBUTE_SURCHARGE';
  userSurchargesAgorot?: Record<number, number>;
}

/**
 * Executes Steps 1–4 of the Cycle Closing Wizard inside a single ACID transaction:
 * - Saves immutable PRE_CLOSE_ORIGINAL snapshot
 * - Handles overflow straddling split & carryover to new cycle
 * - Performs Priority 1 Direct Slot Insertion & Priority 2 Chain Shifting
 * - Asserts final reading + unallocatedLoss === billCurrTenths
 * - Records discounts/surcharges and closes cycle
 */
export async function executeCloseCycle(input: CloseCycleInput): Promise<{
  nextCycleId: number;
}> {
  return db.transaction(
    'rw',
    [
      db.cycles,
      db.readings,
      db.pending_gaps,
      db.cycle_snapshots,
      db.cycle_user_adjustments,
      db.meters,
      db.settings,
    ],
    async () => {
      const cycle = await db.cycles.get(input.cycleId);
      if (!cycle || cycle.status !== 'OPEN') {
        throw new Error('الدورة غير موجودة أو مغلقة بالفعل');
      }

      const mainReadings = await db.readings
        .where('cycle_id')
        .equals(cycle.id!)
        .filter((r) => r.meter_id === cycle.meter_id)
        .toArray();
      mainReadings.sort(
        (a, b) => a.sequence_order - b.sequence_order || (a.id ?? 0) - (b.id ?? 0)
      );

      const pendingGaps = await db.pending_gaps
        .where('cycle_id')
        .equals(cycle.id!)
        .toArray();

      // 1. Save immutable PRE_CLOSE_ORIGINAL snapshot BEFORE any modification
      const overflow = analyzeOverflowReadings(
        mainReadings,
        cycle.opening_reading_tenths,
        input.billCurrTenths
      );

      const snapshotPayload: CycleSnapshotPayload = {
        readings: mainReadings.map((r) => ({ ...r })),
        pending_gaps: pendingGaps.map((g) => ({ ...g })),
        carried_over_reading_ids: [],
        split_reading_info: [],
      };

      // 2. Prepare next cycle (will receive any carried-over / split readings)
      const settings = await getSettings();

      const nextCycleId = (await db.cycles.add({
        meter_id: cycle.meter_id,
        title: `دورة "${formatDateSlash(input.endDate)}"`,
        start_date: input.endDate,
        end_date: null,
        opening_reading_tenths: input.billCurrTenths,
        closing_reading_tenths: null,
        kwh_price_agorot: settings.default_kwh_price_agorot,
        status: 'OPEN',
        bill_prev_tenths: null,
        bill_curr_tenths: null,
        bill_kwh_tenths: null,
        bill_amount_agorot: null,
        unallocated_loss_tenths: 0,
        surcharge_agorot: 0,
        closed_at: null,
      })) as number;

      let nextSeq = 1;
      // Handle straddling readings: Part 1 stays in current cycle, Part 2 moves to next cycle
      for (const r of overflow.straddling) {
        const part1Delta = input.billCurrTenths - r.prev_reading_tenths;
        const part2Delta = r.curr_reading_tenths - input.billCurrTenths;

        await db.readings.update(r.id!, {
          curr_reading_tenths: input.billCurrTenths,
          consumption_tenths: part1Delta,
        });

        const newCycleReadingId = (await db.readings.add({
          cycle_id: nextCycleId,
          meter_id: r.meter_id,
          user_id: r.user_id,
          prev_reading_tenths: input.billCurrTenths,
          curr_reading_tenths: r.curr_reading_tenths,
          consumption_tenths: part2Delta,
          recorded_at: r.recorded_at,
          notes: r.notes,
          linked_sub_reading_id: r.linked_sub_reading_id,
          is_system_generated_from_loss: r.is_system_generated_from_loss,
          sequence_order: nextSeq++,
        })) as number;

        snapshotPayload.split_reading_info!.push({
          original_reading_id: r.id!,
          new_cycle_reading_id: newCycleReadingId,
        });
      }

      // Handle fully-after readings: carry over completely to next cycle
      for (const r of overflow.fullyAfter) {
        await db.readings.update(r.id!, {
          cycle_id: nextCycleId,
          sequence_order: nextSeq++,
        });
        snapshotPayload.carried_over_reading_ids!.push(r.id!);
      }

      // Persist snapshot now that carried_over & split info are recorded
      await db.cycle_snapshots.add({
        cycle_id: cycle.id!,
        snapshot_type: 'PRE_CLOSE_ORIGINAL',
        payload_json: JSON.stringify(snapshotPayload),
        created_at: new Date().toISOString(),
      });

      // 3. Reload current cycle main readings after overflow trim
      let currentReadings = await db.readings
        .where('cycle_id')
        .equals(cycle.id!)
        .filter((r) => r.meter_id === cycle.meter_id)
        .toArray();
      currentReadings.sort(
        (a, b) => a.sequence_order - b.sequence_order || (a.id ?? 0) - (b.id ?? 0)
      );

      // 4. Priority 1 — Direct Slot Insertion for assigned Pending Gaps
      for (const gap of pendingGaps) {
        if (gap.status !== 'PENDING') continue;
        const assignedUserId = input.gapAssignments[gap.id!];
        if (assignedUserId) {
          const insertedId = (await db.readings.add({
            cycle_id: cycle.id!,
            meter_id: cycle.meter_id,
            user_id: assignedUserId,
            prev_reading_tenths: gap.from_reading_tenths,
            curr_reading_tenths: gap.to_reading_tenths,
            consumption_tenths: gap.gap_tenths,
            recorded_at: gap.detected_at,
            notes: '', // Clean: never mention "فاقد"
            linked_sub_reading_id: null,
            is_system_generated_from_loss: true,
            sequence_order: 0, // Will be ordered chronologically/positionally below
          })) as number;
          const inserted = await db.readings.get(insertedId);
          if (inserted) currentReadings.push(inserted);

          await db.pending_gaps.update(gap.id!, {
            status: 'RESOLVED',
            resolved_note: 'تم الإدراج في موضع الفجوة',
          });
        } else {
          await db.pending_gaps.update(gap.id!, {
            status: 'KEPT_AS_LOSS',
          });
        }
      }

      // Priority 1b — Direct Slot Insertion for newly discovered internal/closing gaps
      for (const slotGap of input.slotGapAssignments ?? []) {
        const gapDelta = slotGap.toTenths - slotGap.fromTenths;
        if (gapDelta <= 0 || !slotGap.userId) continue;
        const insertedId = (await db.readings.add({
          cycle_id: cycle.id!,
          meter_id: cycle.meter_id,
          user_id: slotGap.userId,
          prev_reading_tenths: slotGap.fromTenths,
          curr_reading_tenths: slotGap.toTenths,
          consumption_tenths: gapDelta,
          recorded_at: slotGap.detectedAt || input.endDate,
          notes: '',
          linked_sub_reading_id: null,
          is_system_generated_from_loss: true,
          sequence_order: 0,
        })) as number;
        const inserted = await db.readings.get(insertedId);
        if (inserted) currentReadings.push(inserted);
      }

      // Sort by prev_reading_tenths / recorded_at so slot-inserted readings sit in their exact slot
      currentReadings.sort((a, b) => {
        if (a.prev_reading_tenths !== b.prev_reading_tenths) {
          return a.prev_reading_tenths - b.prev_reading_tenths;
        }
        const t = a.recorded_at.localeCompare(b.recorded_at);
        return t !== 0 ? t : (a.id ?? 0) - (b.id ?? 0);
      });

      // 5. Priority 2 — Local Adjustment on targeted users' readings
      for (const [uidStr, lossTenths] of Object.entries(input.userLossAllocations)) {
        const uid = Number(uidStr);
        if (!lossTenths || lossTenths <= 0) continue;

        // Find user's last reading in this cycle
        const userReadings = currentReadings.filter((r) => r.user_id === uid);
        if (userReadings.length > 0) {
          const target = userReadings[userReadings.length - 1];
          target.consumption_tenths += lossTenths;
        } else {
          // User had no readings in cycle: create a clean regular reading for them
          const lastCurr =
            currentReadings.length > 0
              ? currentReadings[currentReadings.length - 1].curr_reading_tenths
              : input.billPrevTenths;
          const newId = (await db.readings.add({
            cycle_id: cycle.id!,
            meter_id: cycle.meter_id,
            user_id: uid,
            prev_reading_tenths: lastCurr,
            curr_reading_tenths: lastCurr + lossTenths,
            consumption_tenths: lossTenths,
            recorded_at: input.endDate,
            notes: '',
            linked_sub_reading_id: null,
            is_system_generated_from_loss: true,
            sequence_order: currentReadings.length + 1,
          })) as number;
          const created = await db.readings.get(newId);
          if (created) currentReadings.push(created);
        }
      }

      // 6. Chain Shifting from billPrevTenths
      let cursor = input.billPrevTenths;
      for (let i = 0; i < currentReadings.length; i++) {
        const r = currentReadings[i];
        const prev = cursor;
        const curr = prev + r.consumption_tenths;
        cursor = curr;
        await db.readings.update(r.id!, {
          prev_reading_tenths: prev,
          curr_reading_tenths: curr,
          consumption_tenths: r.consumption_tenths,
          sequence_order: i + 1,
        });
      }

      // Mandatory Assertion: final reading + unallocatedLoss === billCurrTenths
      if (cursor + input.unallocatedLossTenths !== input.billCurrTenths) {
        throw new Error(
          `خطأ مطابقة: القراءة النهائية (${cursor / 10}) + الفاقد غير الموزع (${
            input.unallocatedLossTenths / 10
          }) لا تساوي قراءة الفاتورة (${input.billCurrTenths / 10})`
        );
      }

      // 7. Financial Reconciliation (Step 4)
      let finalRateAgorot = cycle.kwh_price_agorot;
      const expectedAmount = computeAmountAgorot(
        input.billKwhTenths,
        cycle.kwh_price_agorot
      );
      let surchargeAgorot = 0;

      if (input.billAmountAgorot > expectedAmount) {
        surchargeAgorot = input.billAmountAgorot - expectedAmount;
        if (input.surchargeMode === 'RECALCULATE_RATE' && input.billKwhTenths > 0) {
          finalRateAgorot = Math.round(
            (input.billAmountAgorot * 10) / input.billKwhTenths
          );
          surchargeAgorot = 0;
        }
      }

      // Save per-user adjustments (discounts / surcharges)
      await db.cycle_user_adjustments
        .where('cycle_id')
        .equals(cycle.id!)
        .delete();

      const allAdjUserIds = new Set<number>([
        ...Object.keys(input.userDiscountKwh).map(Number),
        ...Object.keys(input.userSurchargesAgorot ?? {}).map(Number),
      ]);

      for (const uid of allAdjUserIds) {
        const disc = input.userDiscountKwh[uid] ?? 0;
        const sur = input.userSurchargesAgorot?.[uid] ?? 0;
        if (disc > 0 || sur > 0) {
          await db.cycle_user_adjustments.add({
            cycle_id: cycle.id!,
            user_id: uid,
            discount_kwh_tenths: disc,
            surcharge_agorot: sur,
          });
        }
      }

      // 8. Close the cycle
      await db.cycles.update(cycle.id!, {
        status: 'CLOSED',
        title: `دورة "${formatDateSlash(cycle.start_date)} - ${formatDateSlash(input.endDate)}"`,
        end_date: input.endDate,
        opening_reading_tenths: input.billPrevTenths,
        closing_reading_tenths: input.billCurrTenths,
        kwh_price_agorot: finalRateAgorot,
        bill_prev_tenths: input.billPrevTenths,
        bill_curr_tenths: input.billCurrTenths,
        bill_kwh_tenths: input.billKwhTenths,
        bill_amount_agorot: input.billAmountAgorot,
        unallocated_loss_tenths: input.unallocatedLossTenths,
        surcharge_agorot: surchargeAgorot,
        closed_at: new Date().toISOString(),
      });

      return { nextCycleId };
    }
  );
}

/**
 * Admin-only: retrieves the immutable PRE_CLOSE_ORIGINAL snapshot for a closed cycle.
 */
export async function getPreCloseSnapshot(
  cycleId: number
): Promise<CycleSnapshotPayload | null> {
  const snap = await db.cycle_snapshots
    .where('cycle_id')
    .equals(cycleId)
    .filter((s) => s.snapshot_type === 'PRE_CLOSE_ORIGINAL')
    .first();
  if (!snap) return null;
  return JSON.parse(snap.payload_json) as CycleSnapshotPayload;
}

/**
 * Reopens a CLOSED cycle cleanly by restoring readings & pending_gaps from PRE_CLOSE_ORIGINAL,
 * reversing any carried-over/split readings from the subsequent OPEN cycle, and deleting
 * the auto-created empty next cycle if applicable.
 */
export async function reopenCycle(cycleId: number): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.cycles,
      db.readings,
      db.pending_gaps,
      db.cycle_snapshots,
      db.cycle_user_adjustments,
    ],
    async () => {
      const cycle = await db.cycles.get(cycleId);
      if (!cycle || cycle.status !== 'CLOSED') {
        throw new Error('الدورة غير مغلقة');
      }

      // Ensure no newer cycle on the same meter is already CLOSED
      const laterCycles = await db.cycles
        .where('meter_id')
        .equals(cycle.meter_id)
        .filter((c) => (c.id ?? 0) > cycleId)
        .toArray();

      const closedLater = laterCycles.find((c) => c.status === 'CLOSED');
      if (closedLater) {
        throw new Error(
          'لا يمكن إعادة فتح هذه الدورة لأن الدورة التالية لها مغلقة بالفعل.'
        );
      }

      const snap = await db.cycle_snapshots
        .where('cycle_id')
        .equals(cycleId)
        .filter((s) => s.snapshot_type === 'PRE_CLOSE_ORIGINAL')
        .first();
      if (!snap) {
        throw new Error('لم يتم العثور على النسخة الأصلية للدورة');
      }

      const payload = JSON.parse(snap.payload_json) as CycleSnapshotPayload;

      // Remove current readings in this cycle for the main meter (including system-generated ones)
      const currentMainReadings = await db.readings
        .where('cycle_id')
        .equals(cycleId)
        .filter((r) => r.meter_id === cycle.meter_id)
        .toArray();
      for (const r of currentMainReadings) {
        if (r.id !== undefined) await db.readings.delete(r.id);
      }

      // Reverse carried-over and split readings from the next open cycle
      for (const carriedId of payload.carried_over_reading_ids ?? []) {
        await db.readings.delete(carriedId);
      }
      for (const splitInfo of payload.split_reading_info ?? []) {
        await db.readings.delete(splitInfo.new_cycle_reading_id);
      }

      // If there is an open later cycle with 0 remaining readings, remove it
      for (const later of laterCycles) {
        if (later.status === 'OPEN' && later.id !== undefined) {
          const remainingCount = await db.readings
            .where('cycle_id')
            .equals(later.id)
            .count();
          if (remainingCount === 0) {
            await db.cycles.delete(later.id);
          } else {
            throw new Error(
              'الدورة التالية تحتوي على قراءات جديدة مسجلة؛ احذفها أو أغلقها أولاً.'
            );
          }
        }
      }

      // Restore original readings exactly as they were
      for (const orig of payload.readings) {
        await db.readings.put({ ...orig });
      }

      // Restore original pending_gaps
      const currentGaps = await db.pending_gaps
        .where('cycle_id')
        .equals(cycleId)
        .toArray();
      for (const g of currentGaps) {
        if (g.id !== undefined) await db.pending_gaps.delete(g.id);
      }
      for (const origGap of payload.pending_gaps) {
        await db.pending_gaps.put({ ...origGap });
      }

      // Clear adjustments and snapshot
      await db.cycle_user_adjustments.where('cycle_id').equals(cycleId).delete();
      if (snap.id !== undefined) await db.cycle_snapshots.delete(snap.id);

      // Set cycle back to OPEN
      await db.cycles.update(cycleId, {
        status: 'OPEN',
        title: `دورة "${formatDateSlash(cycle.start_date)}"`,
        end_date: null,
        closing_reading_tenths: null,
        bill_prev_tenths: null,
        bill_curr_tenths: null,
        bill_kwh_tenths: null,
        bill_amount_agorot: null,
        unallocated_loss_tenths: 0,
        surcharge_agorot: 0,
        closed_at: null,
      });
    }
  );
}

/**
 * Helper to compute expected discount in kWh tenths for Step 4.
 */
export function computeCycleFinancialDiff(
  billKwhTenths: number,
  billAmountAgorot: number,
  cycleRateAgorot: number
): {
  expectedAmountAgorot: number;
  diffAgorot: number; // positive = discount, negative = surcharge
  discountKwhTenths: number;
  surchargeAgorot: number;
} {
  const expectedAmountAgorot = computeAmountAgorot(billKwhTenths, cycleRateAgorot);
  const diffAgorot = expectedAmountAgorot - billAmountAgorot;
  if (diffAgorot > 0) {
    return {
      expectedAmountAgorot,
      diffAgorot,
      discountKwhTenths: agorotToKwhTenths(diffAgorot, cycleRateAgorot),
      surchargeAgorot: 0,
    };
  }
  return {
    expectedAmountAgorot,
    diffAgorot,
    discountKwhTenths: 0,
    surchargeAgorot: Math.abs(diffAgorot),
  };
}
