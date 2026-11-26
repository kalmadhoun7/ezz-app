import { db } from './database';
import type { User } from '../types/models';
import { computeAmountAgorot } from '../utils/math';

export async function getAllUsers(includeArchived = false): Promise<User[]> {
  const all = await db.users.toArray();
  const filtered = includeArchived ? all : all.filter((u) => u.is_active);
  return filtered.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export async function addUser(input: {
  name: string;
  whatsapp_phone?: string | null;
  notes?: string;
}): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new Error('اسم المستخدم مطلوب');

  const existing = await db.users.where('name').equals(name).first();
  if (existing) {
    throw new Error('يوجد مستخدم آخر بنفس الاسم');
  }

  const id = await db.users.add({
    name,
    whatsapp_phone: input.whatsapp_phone?.trim() || null,
    notes: input.notes?.trim() || '',
    is_active: true,
    created_at: new Date().toISOString(),
  });
  return id as number;
}

export async function updateUser(
  id: number,
  updates: Partial<Pick<User, 'name' | 'whatsapp_phone' | 'notes' | 'is_active'>>
): Promise<void> {
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) throw new Error('اسم المستخدم مطلوب');
    const existing = await db.users.where('name').equals(trimmed).first();
    if (existing && existing.id !== id) {
      throw new Error('يوجد مستخدم آخر بنفس الاسم');
    }
    updates.name = trimmed;
  }
  await db.users.update(id, {
    ...updates,
    whatsapp_phone:
      updates.whatsapp_phone !== undefined
        ? updates.whatsapp_phone?.trim() || null
        : undefined,
    notes: updates.notes !== undefined ? updates.notes.trim() : undefined,
  });
}

export async function archiveOrDeleteUser(id: number): Promise<'archived' | 'deleted'> {
  const readingsCount = await db.readings.where('user_id').equals(id).count();
  const paymentsCount = await db.payments.where('user_id').equals(id).count();
  if (readingsCount > 0 || paymentsCount > 0) {
    await db.users.update(id, { is_active: false });
    return 'archived';
  }
  await db.users.delete(id);
  return 'deleted';
}

export interface UserFinancialSummary {
  userId: number;
  closedCyclesDueAgorot: number;
  openCyclesEstimatedAgorot: number;
  totalPaidAgorot: number;
  /** Positive = user owes money (debt), Negative = credit balance */
  balanceDueAgorot: number;
}

/**
 * Computes a user's cumulative balance across all CLOSED cycles minus total payments.
 * Note: Only counts MAIN meter readings to prevent double-billing sub-meters.
 */
export async function getUserFinancialSummary(userId: number): Promise<UserFinancialSummary> {
  const [cycles, meters, allUserReadings, adjustments, payments] = await Promise.all([
    db.cycles.toArray(),
    db.meters.toArray(),
    db.readings.where('user_id').equals(userId).toArray(),
    db.cycle_user_adjustments.where('user_id').equals(userId).toArray(),
    db.payments.where('user_id').equals(userId).toArray(),
  ]);

  const mainMeterIds = new Set(meters.filter((m) => m.type === 'MAIN').map((m) => m.id!));
  const adjByCycle = new Map(adjustments.map((a) => [a.cycle_id, a]));

  let closedCyclesDueAgorot = 0;
  let openCyclesEstimatedAgorot = 0;

  for (const cycle of cycles) {
    const cycleReadings = allUserReadings.filter(
      (r) => r.cycle_id === cycle.id && mainMeterIds.has(r.meter_id)
    );
    const rawKwhTenths = cycleReadings.reduce((sum, r) => sum + r.consumption_tenths, 0);
    const adj = adjByCycle.get(cycle.id!);
    const totalKwhTenths = Math.max(0, rawKwhTenths + (adj?.reallocation_kwh_tenths ?? 0));
    const discountTenths = adj?.discount_kwh_tenths ?? 0;
    const surchargeAgorot = adj?.surcharge_agorot ?? 0;

    const netKwhTenths = Math.max(0, totalKwhTenths - discountTenths);
    const cycleDue = computeAmountAgorot(netKwhTenths, cycle.kwh_price_agorot) + surchargeAgorot;

    if (cycle.status === 'CLOSED') {
      closedCyclesDueAgorot += cycleDue;
    } else {
      openCyclesEstimatedAgorot += cycleDue;
    }
  }

  const totalPaidAgorot = payments.reduce((sum, p) => sum + p.amount_agorot, 0);
  const balanceDueAgorot = closedCyclesDueAgorot - totalPaidAgorot;

  return {
    userId,
    closedCyclesDueAgorot,
    openCyclesEstimatedAgorot,
    totalPaidAgorot,
    balanceDueAgorot,
  };
}
