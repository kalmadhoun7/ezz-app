import Dexie, { type EntityTable } from 'dexie';
import { formatDateSlash } from '../utils/format';
import type {
  Cycle,
  CycleSnapshot,
  CycleUserAdjustment,
  Meter,
  Payment,
  PendingGap,
  Reading,
  Settings,
  User,
} from '../types/models';

export class SmlDatabase extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  meters!: EntityTable<Meter, 'id'>;
  users!: EntityTable<User, 'id'>;
  cycles!: EntityTable<Cycle, 'id'>;
  readings!: EntityTable<Reading, 'id'>;
  pending_gaps!: EntityTable<PendingGap, 'id'>;
  cycle_user_adjustments!: EntityTable<CycleUserAdjustment, 'id'>;
  payments!: EntityTable<Payment, 'id'>;
  cycle_snapshots!: EntityTable<CycleSnapshot, 'id'>;

  constructor() {
    super('SharedMeterLedgerDB');
    this.version(1).stores({
      settings: 'id',
      meters: '++id, type, parent_meter_id, default_user_id, is_active',
      users: '++id, &name, is_active',
      cycles: '++id, meter_id, status, start_date',
      readings: '++id, cycle_id, meter_id, user_id, recorded_at, linked_sub_reading_id, sequence_order',
      pending_gaps: '++id, cycle_id, meter_id, status, detected_at',
      cycle_user_adjustments: '++id, cycle_id, user_id, [cycle_id+user_id]',
      payments: '++id, user_id, cycle_id, payment_date',
      cycle_snapshots: '++id, cycle_id, snapshot_type',
    });
  }
}

export const db = new SmlDatabase();

/**
 * Ensures default settings and an initial main meter exist on first launch.
 */
export async function ensureInitialData(): Promise<void> {
  await db.transaction('rw', [db.settings, db.meters, db.cycles], async () => {
    const existingSettings = await db.settings.get(1);
    if (!existingSettings) {
      await db.settings.put({
        id: 1,
        default_kwh_price_agorot: 1000, // 10.00 ILS default
        currency_symbol: 'شيكل',
        anomaly_threshold_tenths: 1000, // 100.0 kWh
        default_invoice_mode: 'COMPACT',
        show_discount_by_default: false,
      });
    }

    const meterCount = await db.meters.count();
    if (meterCount === 0) {
      await db.meters.add({
        name: 'العداد الرئيسي',
        type: 'MAIN',
        parent_meter_id: null,
        default_user_id: null,
        is_active: true,
        created_at: new Date().toISOString(),
      });
    }

    // One-time migration: normalize existing cycle names to date-based format
    const migrationKey = 'sml_cycle_titles_migrated_v4';
    const alreadyMigrated =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(migrationKey) === '1';

    if (!alreadyMigrated) {
      const allCycles = await db.cycles.toArray();
      for (const c of allCycles) {
        if (c.id === undefined) continue;
        if (c.status === 'CLOSED' && c.end_date) {
          await db.cycles.update(c.id, {
            title: `دورة "${formatDateSlash(c.start_date)} - ${formatDateSlash(c.end_date)}"`,
          });
        } else if (c.status === 'OPEN') {
          await db.cycles.update(c.id, {
            title: `دورة "${formatDateSlash(c.start_date)}"`,
          });
        }
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(migrationKey, '1');
      }
    }
  });
}
