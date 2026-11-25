import { db } from './database';

export interface SmlBackupPayload {
  version: 1;
  exported_at: string;
  tables: {
    settings: unknown[];
    meters: unknown[];
    users: unknown[];
    cycles: unknown[];
    readings: unknown[];
    pending_gaps: unknown[];
    cycle_user_adjustments: unknown[];
    payments: unknown[];
    cycle_snapshots: unknown[];
  };
}

const REQUIRED_TABLES = [
  'settings',
  'meters',
  'users',
  'cycles',
  'readings',
  'pending_gaps',
  'cycle_user_adjustments',
  'payments',
  'cycle_snapshots',
] as const;

/**
 * Exports all 9 IndexedDB tables into a single JSON backup object.
 */
export async function exportFullBackup(): Promise<SmlBackupPayload> {
  const [
    settings,
    meters,
    users,
    cycles,
    readings,
    pending_gaps,
    cycle_user_adjustments,
    payments,
    cycle_snapshots,
  ] = await Promise.all([
    db.settings.toArray(),
    db.meters.toArray(),
    db.users.toArray(),
    db.cycles.toArray(),
    db.readings.toArray(),
    db.pending_gaps.toArray(),
    db.cycle_user_adjustments.toArray(),
    db.payments.toArray(),
    db.cycle_snapshots.toArray(),
  ]);

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    tables: {
      settings,
      meters,
      users,
      cycles,
      readings,
      pending_gaps,
      cycle_user_adjustments,
      payments,
      cycle_snapshots,
    },
  };
}

/**
 * Validates backup JSON schema strictly before touching the database.
 */
export function validateBackupPayload(data: unknown): data is SmlBackupPayload {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return false;
  if (!obj.tables || typeof obj.tables !== 'object') return false;

  const tables = obj.tables as Record<string, unknown>;
  for (const key of REQUIRED_TABLES) {
    if (!Array.isArray(tables[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Atomically replaces all local database tables with the validated backup.
 */
export async function restoreFullBackup(rawJson: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('ملف النسخة الاحتياطية غير صالح (JSON غير مقروء)');
  }

  if (!validateBackupPayload(parsed)) {
    throw new Error('هيكل ملف النسخة الاحتياطية غير مطابق للمواصفات المطلوبة');
  }

  const { tables } = parsed;

  await db.transaction(
    'rw',
    [
      db.settings,
      db.meters,
      db.users,
      db.cycles,
      db.readings,
      db.pending_gaps,
      db.cycle_user_adjustments,
      db.payments,
      db.cycle_snapshots,
    ],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.meters.clear(),
        db.users.clear(),
        db.cycles.clear(),
        db.readings.clear(),
        db.pending_gaps.clear(),
        db.cycle_user_adjustments.clear(),
        db.payments.clear(),
        db.cycle_snapshots.clear(),
      ]);

      if (tables.settings.length) await db.settings.bulkPut(tables.settings as never[]);
      if (tables.meters.length) await db.meters.bulkPut(tables.meters as never[]);
      if (tables.users.length) await db.users.bulkPut(tables.users as never[]);
      if (tables.cycles.length) await db.cycles.bulkPut(tables.cycles as never[]);
      if (tables.readings.length) await db.readings.bulkPut(tables.readings as never[]);
      if (tables.pending_gaps.length) await db.pending_gaps.bulkPut(tables.pending_gaps as never[]);
      if (tables.cycle_user_adjustments.length)
        await db.cycle_user_adjustments.bulkPut(tables.cycle_user_adjustments as never[]);
      if (tables.payments.length) await db.payments.bulkPut(tables.payments as never[]);
      if (tables.cycle_snapshots.length)
        await db.cycle_snapshots.bulkPut(tables.cycle_snapshots as never[]);
    }
  );
}
