import { db } from './database';
import type { Meter, MeterType } from '../types/models';

export async function getAllMeters(includeInactive = false): Promise<Meter[]> {
  const all = await db.meters.toArray();
  return includeInactive ? all : all.filter((m) => m.is_active);
}

export async function getMainMeters(includeInactive = false): Promise<Meter[]> {
  const all = await getAllMeters(includeInactive);
  return all.filter((m) => m.type === 'MAIN');
}

export async function getSubMetersForMain(
  mainMeterId: number,
  includeInactive = false
): Promise<Meter[]> {
  const all = await getAllMeters(includeInactive);
  return all.filter((m) => m.type === 'SUB' && m.parent_meter_id === mainMeterId);
}

export async function addMeter(input: {
  name: string;
  type: MeterType;
  parent_meter_id: number | null;
  default_user_id: number | null;
}): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new Error('اسم العداد مطلوب');
  if (input.type === 'SUB' && !input.parent_meter_id) {
    throw new Error('يجب تحديد العداد الرئيسي المرتبط بالعداد الفرعي');
  }
  const id = await db.meters.add({
    name,
    type: input.type,
    parent_meter_id: input.type === 'SUB' ? input.parent_meter_id : null,
    default_user_id: input.type === 'SUB' ? input.default_user_id : null,
    is_active: true,
    created_at: new Date().toISOString(),
  });
  return id as number;
}

export async function updateMeter(
  id: number,
  updates: Partial<Pick<Meter, 'name' | 'parent_meter_id' | 'default_user_id' | 'is_active'>>
): Promise<void> {
  if (updates.name !== undefined && !updates.name.trim()) {
    throw new Error('اسم العداد مطلوب');
  }
  await db.meters.update(id, {
    ...updates,
    name: updates.name?.trim(),
  });
}
