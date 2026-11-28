import { db } from './database';
import { getLastReadingForMeter } from './cycleService';
import type { PendingGap, Reading } from '../types/models';

export interface AddReadingInput {
  cycle_id: number;
  meter_id: number;
  user_id: number;
  prev_reading_tenths: number;
  curr_reading_tenths: number;
  recorded_at: string;
  notes?: string;
}

export type GapResolution =
  | { mode: 'NONE' }
  | { mode: 'PENDING_GAP' }
  | { mode: 'ASSIGN_TO_USER'; gap_user_id: number };

export type OverlapResolution =
  | 'NONE'
  | 'INSERT_AND_SHIFT'
  | 'DEDUCT_FROM_NEXT'
  | 'DEDUCT_FROM_PREV'
  | 'KEEP_AS_IS';

export interface OverlapCandidate {
  id: number;
  userId: number;
  prev: number;
  curr: number;
  consumption: number;
}

export interface AddReadingResult {
  readingId: number;
  linkedMainReadingId?: number;
  gapId?: number;
}

async function getNextSequenceOrder(cycleId: number, meterId: number): Promise<number> {
  const existing = await db.readings
    .where('cycle_id')
    .equals(cycleId)
    .filter((r) => r.meter_id === meterId)
    .toArray();
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((r) => r.sequence_order)) + 1;
}

/**
 * Checks if a MAIN meter reading has prev_reading_tenths > lastRecordedReading.
 * Returns gap details if a gap exists, otherwise null.
 */
export async function detectMainMeterGap(
  cycleId: number,
  mainMeterId: number,
  enteredPrevTenths: number
): Promise<{ lastRecordedTenths: number; gapTenths: number } | null> {
  const lastRecorded = await getLastReadingForMeter(mainMeterId, cycleId);
  if (enteredPrevTenths > lastRecorded) {
    return {
      lastRecordedTenths: lastRecorded,
      gapTenths: enteredPrevTenths - lastRecorded,
    };
  }
  return null;
}

/**
 * Checks if a MAIN meter reading [enteredPrevTenths, enteredCurrTenths) actually overlaps
 * with any existing recorded reading interval [r.prev, r.curr) on the meter.
 * Backdated readings in an empty gap (no intersection) return null.
 */
export async function detectMainMeterOverlap(
  cycleId: number,
  mainMeterId: number,
  enteredPrevTenths: number,
  enteredCurrTenths: number
): Promise<{
  overlappingReadings: OverlapCandidate[];
  affectedCount: number;
  nextCandidate?: OverlapCandidate;
  prevCandidate?: OverlapCandidate;
} | null> {
  const delta = enteredCurrTenths - enteredPrevTenths;
  if (delta <= 0) return null;

  const allMain = await db.readings
    .where('cycle_id')
    .equals(cycleId)
    .filter((r) => r.meter_id === mainMeterId)
    .toArray();
  allMain.sort(
    (a, b) => a.prev_reading_tenths - b.prev_reading_tenths || (a.id ?? 0) - (b.id ?? 0)
  );

  // Strict interval intersection: max(prevA, prevB) < min(currA, currB)
  const intersecting = allMain.filter(
    (r) =>
      Math.max(r.prev_reading_tenths, enteredPrevTenths) <
      Math.min(r.curr_reading_tenths, enteredCurrTenths)
  );

  if (intersecting.length === 0) {
    return null;
  }

  const affectedCount = allMain.filter(
    (r) => r.prev_reading_tenths >= enteredPrevTenths
  ).length;

  const nextMatch = intersecting.find(
    (r) =>
      r.prev_reading_tenths >= enteredPrevTenths &&
      r.consumption_tenths >= delta
  );

  const prevMatch = [...intersecting]
    .reverse()
    .find(
      (r) =>
        r.prev_reading_tenths < enteredPrevTenths &&
        r.consumption_tenths >= delta
    );

  const toCandidate = (r: Reading): OverlapCandidate => ({
    id: r.id!,
    userId: r.user_id,
    prev: r.prev_reading_tenths,
    curr: r.curr_reading_tenths,
    consumption: r.consumption_tenths,
  });

  return {
    overlappingReadings: intersecting.map(toCandidate),
    affectedCount,
    nextCandidate: nextMatch ? toCandidate(nextMatch) : undefined,
    prevCandidate: prevMatch ? toCandidate(prevMatch) : undefined,
  };
}

/**
 * Atomically adds a reading.
 * - If meter is SUB: creates SUB reading + linked MAIN reading (`linked_sub_reading_id`) in one transaction.
 * - If meter is MAIN and gapResolution is provided: handles PendingGap or immediate user assignment atomically.
 */
export async function addReading(
  input: AddReadingInput,
  gapResolution: GapResolution = { mode: 'NONE' },
  overlapResolution: OverlapResolution = 'NONE'
): Promise<AddReadingResult> {
  if (input.curr_reading_tenths < input.prev_reading_tenths) {
    throw new Error('القراءة الحالية لا يمكن أن تكون أقل من القراءة السابقة');
  }

  return db.transaction(
    'rw',
    [db.readings, db.pending_gaps, db.meters, db.cycles],
    async () => {
      const meter = await db.meters.get(input.meter_id);
      if (!meter) throw new Error('العداد غير موجود');

      const delta = input.curr_reading_tenths - input.prev_reading_tenths;
      const notes = input.notes?.trim() || '';

      if (meter.type === 'SUB') {
        if (!meter.parent_meter_id) {
          throw new Error('العداد الفرعي غير مرتبط بعداد رئيسي');
        }
        const subSeq = await getNextSequenceOrder(input.cycle_id, meter.id!);
        const subReadingId = (await db.readings.add({
          cycle_id: input.cycle_id,
          meter_id: meter.id!,
          user_id: input.user_id,
          prev_reading_tenths: input.prev_reading_tenths,
          curr_reading_tenths: input.curr_reading_tenths,
          consumption_tenths: delta,
          recorded_at: input.recorded_at,
          notes,
          linked_sub_reading_id: null,
          is_system_generated_from_loss: false,
          sequence_order: subSeq,
        })) as number;

        // Sync to parent MAIN meter atomically
        const lastMainCurr = await getLastReadingForMeter(
          meter.parent_meter_id,
          input.cycle_id
        );
        const mainSeq = await getNextSequenceOrder(
          input.cycle_id,
          meter.parent_meter_id
        );
        const linkedMainReadingId = (await db.readings.add({
          cycle_id: input.cycle_id,
          meter_id: meter.parent_meter_id,
          user_id: input.user_id,
          prev_reading_tenths: lastMainCurr,
          curr_reading_tenths: lastMainCurr + delta,
          consumption_tenths: delta,
          recorded_at: input.recorded_at,
          notes: notes ? `[${meter.name}] ${notes}` : `[${meter.name}]`,
          linked_sub_reading_id: subReadingId,
          is_system_generated_from_loss: false,
          sequence_order: mainSeq,
        })) as number;

        return { readingId: subReadingId, linkedMainReadingId };
      }

      // MAIN meter reading
      let gapId: number | undefined;
      const lastRecorded = await getLastReadingForMeter(meter.id!, input.cycle_id);

      if (overlapResolution === 'INSERT_AND_SHIFT') {
        // Shift all subsequent/overlapping readings on this MAIN meter by +delta
        // while preserving every reading's consumption_tenths unchanged.
        const toShift = await db.readings
          .where('cycle_id')
          .equals(input.cycle_id)
          .filter(
            (r) =>
              r.meter_id === meter.id! &&
              r.prev_reading_tenths >= input.prev_reading_tenths
          )
          .toArray();

        for (const r of toShift) {
          await db.readings.update(r.id!, {
            prev_reading_tenths: r.prev_reading_tenths + delta,
            curr_reading_tenths: r.curr_reading_tenths + delta,
          });
        }

        // Shift any PENDING gaps at or after the insertion point
        const gapsToShift = await db.pending_gaps
          .where('cycle_id')
          .equals(input.cycle_id)
          .filter(
            (g) =>
              g.status === 'PENDING' &&
              g.from_reading_tenths >= input.prev_reading_tenths
          )
          .toArray();

        for (const g of gapsToShift) {
          await db.pending_gaps.update(g.id!, {
            from_reading_tenths: g.from_reading_tenths + delta,
            to_reading_tenths: g.to_reading_tenths + delta,
          });
        }
      } else if (overlapResolution === 'DEDUCT_FROM_NEXT') {
        const allMain = await db.readings
          .where('cycle_id')
          .equals(input.cycle_id)
          .filter((r) => r.meter_id === meter.id!)
          .toArray();
        allMain.sort(
          (a, b) => a.prev_reading_tenths - b.prev_reading_tenths || (a.id ?? 0) - (b.id ?? 0)
        );
        const nextMatch = allMain.find(
          (r) =>
            Math.max(r.prev_reading_tenths, input.prev_reading_tenths) <
              Math.min(r.curr_reading_tenths, input.curr_reading_tenths) &&
            r.prev_reading_tenths >= input.prev_reading_tenths &&
            r.consumption_tenths >= delta
        );
        if (nextMatch?.id !== undefined) {
          await db.readings.update(nextMatch.id, {
            prev_reading_tenths: nextMatch.prev_reading_tenths + delta,
            consumption_tenths: nextMatch.consumption_tenths - delta,
          });
        }
      } else if (overlapResolution === 'DEDUCT_FROM_PREV') {
        const allMain = await db.readings
          .where('cycle_id')
          .equals(input.cycle_id)
          .filter((r) => r.meter_id === meter.id!)
          .toArray();
        allMain.sort(
          (a, b) => a.prev_reading_tenths - b.prev_reading_tenths || (a.id ?? 0) - (b.id ?? 0)
        );
        const prevMatch = [...allMain]
          .reverse()
          .find(
            (r) =>
              Math.max(r.prev_reading_tenths, input.prev_reading_tenths) <
                Math.min(r.curr_reading_tenths, input.curr_reading_tenths) &&
              r.prev_reading_tenths < input.prev_reading_tenths &&
              r.consumption_tenths >= delta
          );
        if (prevMatch?.id !== undefined) {
          await db.readings.update(prevMatch.id, {
            curr_reading_tenths: prevMatch.curr_reading_tenths - delta,
            consumption_tenths: prevMatch.consumption_tenths - delta,
          });
        }
      } else if (input.prev_reading_tenths > lastRecorded) {
        const gapTenths = input.prev_reading_tenths - lastRecorded;
        if (gapResolution.mode === 'PENDING_GAP') {
          gapId = (await db.pending_gaps.add({
            cycle_id: input.cycle_id,
            meter_id: meter.id!,
            from_reading_tenths: lastRecorded,
            to_reading_tenths: input.prev_reading_tenths,
            gap_tenths: gapTenths,
            detected_at: input.recorded_at,
            status: 'PENDING',
            resolved_note: '',
          })) as number;
        } else if (gapResolution.mode === 'ASSIGN_TO_USER') {
          const gapSeq = await getNextSequenceOrder(input.cycle_id, meter.id!);
          await db.readings.add({
            cycle_id: input.cycle_id,
            meter_id: meter.id!,
            user_id: gapResolution.gap_user_id,
            prev_reading_tenths: lastRecorded,
            curr_reading_tenths: input.prev_reading_tenths,
            consumption_tenths: gapTenths,
            recorded_at: input.recorded_at,
            notes: '',
            linked_sub_reading_id: null,
            is_system_generated_from_loss: false,
            sequence_order: gapSeq,
          });
        }
      }

      const mainSeq = await getNextSequenceOrder(input.cycle_id, meter.id!);
      const readingId = (await db.readings.add({
        cycle_id: input.cycle_id,
        meter_id: meter.id!,
        user_id: input.user_id,
        prev_reading_tenths: input.prev_reading_tenths,
        curr_reading_tenths: input.curr_reading_tenths,
        consumption_tenths: delta,
        recorded_at: input.recorded_at,
        notes,
        linked_sub_reading_id: null,
        is_system_generated_from_loss: false,
        sequence_order: mainSeq,
      })) as number;

      // Reconcile any PENDING gaps that are fully or partially covered by this new reading
      await reconcilePendingGapsWithReading(
        input.cycle_id,
        meter.id!,
        input.prev_reading_tenths,
        input.curr_reading_tenths
      );

      // Re-normalize sequence_order by prev_reading_tenths so order stays clean
      if (
        overlapResolution === 'INSERT_AND_SHIFT' ||
        overlapResolution === 'DEDUCT_FROM_NEXT' ||
        overlapResolution === 'DEDUCT_FROM_PREV'
      ) {
        const allMain = await db.readings
          .where('cycle_id')
          .equals(input.cycle_id)
          .filter((r) => r.meter_id === meter.id!)
          .toArray();
        allMain.sort(
          (a, b) =>
            a.prev_reading_tenths - b.prev_reading_tenths ||
            a.recorded_at.localeCompare(b.recorded_at) ||
            (a.id ?? 0) - (b.id ?? 0)
        );
        for (let i = 0; i < allMain.length; i++) {
          await db.readings.update(allMain[i].id!, { sequence_order: i + 1 });
        }
      }

      return { readingId, gapId };
    }
  );
}

/**
 * Updates a reading atomically. If it's a SUB reading (or a MAIN reading linked to a SUB reading),
 * keeps both synchronized so no double billing or drift occurs.
 */
export async function updateReading(
  id: number,
  updates: {
    user_id: number;
    prev_reading_tenths: number;
    curr_reading_tenths: number;
    recorded_at: string;
    notes: string;
  }
): Promise<void> {
  if (updates.curr_reading_tenths < updates.prev_reading_tenths) {
    throw new Error('القراءة الحالية لا يمكن أن تكون أقل من القراءة السابقة');
  }

  await db.transaction('rw', [db.readings, db.meters], async () => {
    const existing = await db.readings.get(id);
    if (!existing) throw new Error('القراءة غير موجودة');

    const newDelta = updates.curr_reading_tenths - updates.prev_reading_tenths;
    await db.readings.update(id, {
      user_id: updates.user_id,
      prev_reading_tenths: updates.prev_reading_tenths,
      curr_reading_tenths: updates.curr_reading_tenths,
      consumption_tenths: newDelta,
      recorded_at: updates.recorded_at,
      notes: updates.notes.trim(),
    });

    const meter = await db.meters.get(existing.meter_id);
    if (meter?.type === 'SUB') {
      // Find linked MAIN reading
      const linkedMain = await db.readings
        .where('linked_sub_reading_id')
        .equals(id)
        .first();
      if (linkedMain && linkedMain.id !== undefined) {
        await db.readings.update(linkedMain.id, {
          user_id: updates.user_id,
          curr_reading_tenths: linkedMain.prev_reading_tenths + newDelta,
          consumption_tenths: newDelta,
          recorded_at: updates.recorded_at,
          notes: updates.notes.trim()
            ? `[${meter.name}] ${updates.notes.trim()}`
            : `[${meter.name}]`,
        });
      }
    } else if (existing.linked_sub_reading_id !== null) {
      // Edited from the MAIN side -> sync SUB consumption
      const linkedSub = await db.readings.get(existing.linked_sub_reading_id);
      if (linkedSub && linkedSub.id !== undefined) {
        await db.readings.update(linkedSub.id, {
          user_id: updates.user_id,
          curr_reading_tenths: linkedSub.prev_reading_tenths + newDelta,
          consumption_tenths: newDelta,
          recorded_at: updates.recorded_at,
        });
      }
    }
  });
}

/**
 * Deletes a reading atomically, also deleting its linked MAIN or SUB counterpart if present.
 */
export async function deleteReading(id: number): Promise<void> {
  await db.transaction('rw', [db.readings, db.meters], async () => {
    const existing = await db.readings.get(id);
    if (!existing) return;

    await db.readings.delete(id);

    const meter = await db.meters.get(existing.meter_id);
    if (meter?.type === 'SUB') {
      const linkedMain = await db.readings
        .where('linked_sub_reading_id')
        .equals(id)
        .first();
      if (linkedMain?.id !== undefined) {
        await db.readings.delete(linkedMain.id);
      }
    } else if (existing.linked_sub_reading_id !== null) {
      await db.readings.delete(existing.linked_sub_reading_id);
    }
  });
}

export async function getCycleMainReadings(
  cycleId: number,
  mainMeterId: number
): Promise<Reading[]> {
  const all = await db.readings
    .where('cycle_id')
    .equals(cycleId)
    .filter((r) => r.meter_id === mainMeterId)
    .toArray();
  return all.sort((a, b) => a.sequence_order - b.sequence_order || (a.id ?? 0) - (b.id ?? 0));
}

export async function getCyclePendingGaps(cycleId: number): Promise<PendingGap[]> {
  return db.pending_gaps
    .where('cycle_id')
    .equals(cycleId)
    .filter((g) => g.status === 'PENDING')
    .toArray();
}

export async function resolvePendingGapToUser(
  gapId: number,
  userId: number
): Promise<void> {
  await db.transaction('rw', [db.pending_gaps, db.readings], async () => {
    const gap = await db.pending_gaps.get(gapId);
    if (!gap || gap.status !== 'PENDING') return;

    const seq = await getNextSequenceOrder(gap.cycle_id, gap.meter_id);
    await db.readings.add({
      cycle_id: gap.cycle_id,
      meter_id: gap.meter_id,
      user_id: userId,
      prev_reading_tenths: gap.from_reading_tenths,
      curr_reading_tenths: gap.to_reading_tenths,
      consumption_tenths: gap.gap_tenths,
      recorded_at: gap.detected_at,
      notes: '',
      linked_sub_reading_id: null,
      is_system_generated_from_loss: false,
      sequence_order: seq,
    });

    await db.pending_gaps.update(gapId, {
      status: 'RESOLVED',
      resolved_note: 'تم الإسناد لمستخدم',
    });
  });
}

/**
 * Resolves an overlap between two consecutive readings by assigning the overlapping
 * range [from, to] to either the previous reading ('KEEP_PREV') or the next reading ('KEEP_NEXT'),
 * deducting the overlap from the other reading atomically.
 */
export async function resolveOverlapBetweenReadings(params: {
  prevReadingId: number;
  nextReadingId: number;
  overlapTenths: number;
  keepSide: 'KEEP_PREV' | 'KEEP_NEXT';
}): Promise<void> {
  const { prevReadingId, nextReadingId, overlapTenths, keepSide } = params;
  if (overlapTenths <= 0) return;

  await db.transaction('rw', [db.readings], async () => {
    const prevR = await db.readings.get(prevReadingId);
    const nextR = await db.readings.get(nextReadingId);
    if (!prevR || !nextR) return;

    if (keepSide === 'KEEP_PREV') {
      // Keep overlap on prevR; trim start of nextR forward to prevR.curr_reading_tenths
      const newNextPrev = Math.max(
        nextR.prev_reading_tenths + overlapTenths,
        Math.min(prevR.curr_reading_tenths, nextR.curr_reading_tenths)
      );
      const newNextConsumption = nextR.curr_reading_tenths - newNextPrev;
      if (newNextConsumption <= 0) {
        await db.readings.delete(nextReadingId);
      } else {
        await db.readings.update(nextReadingId, {
          prev_reading_tenths: newNextPrev,
          consumption_tenths: newNextConsumption,
        });
      }
    } else {
      // Keep overlap on nextR; deduct from prevR without shifting anyone else
      if (
        prevR.prev_reading_tenths < nextR.prev_reading_tenths &&
        prevR.curr_reading_tenths > nextR.curr_reading_tenths
      ) {
        // prevR completely contains nextR: split prevR around [nextR.prev, nextR.curr]
        const part1Delta = nextR.prev_reading_tenths - prevR.prev_reading_tenths;
        const part2Delta = prevR.curr_reading_tenths - nextR.curr_reading_tenths;
        await db.readings.update(prevReadingId, {
          curr_reading_tenths: nextR.prev_reading_tenths,
          consumption_tenths: part1Delta,
        });
        if (part2Delta > 0) {
          await db.readings.add({
            cycle_id: prevR.cycle_id,
            meter_id: prevR.meter_id,
            user_id: prevR.user_id,
            prev_reading_tenths: nextR.curr_reading_tenths,
            curr_reading_tenths: prevR.curr_reading_tenths,
            consumption_tenths: part2Delta,
            recorded_at: prevR.recorded_at,
            notes: prevR.notes,
            linked_sub_reading_id: null,
            is_system_generated_from_loss: prevR.is_system_generated_from_loss,
            sequence_order: prevR.sequence_order,
          });
        }
      } else {
        const newPrevCurr = prevR.curr_reading_tenths - overlapTenths;
        const newPrevConsumption = newPrevCurr - prevR.prev_reading_tenths;
        if (newPrevConsumption <= 0) {
          await db.readings.delete(prevReadingId);
        } else {
          await db.readings.update(prevReadingId, {
            curr_reading_tenths: newPrevCurr,
            consumption_tenths: newPrevConsumption,
          });
        }
      }
    }
  });
}

/**
 * Automatically shrinks or resolves any PENDING gaps in `cycleId` that are
 * partially or fully covered by a reading [newPrev, newCurr].
 */
export async function reconcilePendingGapsWithReading(
  cycleId: number,
  mainMeterId: number,
  newPrev: number,
  newCurr: number
): Promise<void> {
  if (newCurr <= newPrev) return;
  const gaps = await db.pending_gaps
    .where('cycle_id')
    .equals(cycleId)
    .filter((g) => g.meter_id === mainMeterId && g.status === 'PENDING')
    .toArray();

  for (const g of gaps) {
    if (g.id === undefined) continue;
    const overlapStart = Math.max(g.from_reading_tenths, newPrev);
    const overlapEnd = Math.min(g.to_reading_tenths, newCurr);
    if (overlapEnd <= overlapStart) continue;

    if (newPrev <= g.from_reading_tenths && newCurr >= g.to_reading_tenths) {
      await db.pending_gaps.update(g.id, {
        status: 'RESOLVED',
        resolved_note: 'تمت التغطية بقراءة جديدة',
      });
    } else if (newPrev <= g.from_reading_tenths && newCurr < g.to_reading_tenths) {
      await db.pending_gaps.update(g.id, {
        from_reading_tenths: newCurr,
        gap_tenths: g.to_reading_tenths - newCurr,
      });
    } else if (newPrev > g.from_reading_tenths && newCurr >= g.to_reading_tenths) {
      await db.pending_gaps.update(g.id, {
        to_reading_tenths: newPrev,
        gap_tenths: newPrev - g.from_reading_tenths,
      });
    } else {
      await db.pending_gaps.update(g.id, {
        to_reading_tenths: newPrev,
        gap_tenths: newPrev - g.from_reading_tenths,
      });
      await db.pending_gaps.add({
        cycle_id: g.cycle_id,
        meter_id: g.meter_id,
        from_reading_tenths: newCurr,
        to_reading_tenths: g.to_reading_tenths,
        gap_tenths: g.to_reading_tenths - newCurr,
        detected_at: g.detected_at,
        status: 'PENDING',
        resolved_note: '',
      });
    }
  }
}
