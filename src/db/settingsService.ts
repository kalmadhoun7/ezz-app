import { db } from './database';
import type { Settings } from '../types/models';

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get(1);
  if (s) return s;
  const fallback: Settings = {
    id: 1,
    default_kwh_price_agorot: 1000,
    currency_symbol: 'شيكل',
    anomaly_threshold_tenths: 1000,
    default_invoice_mode: 'COMPACT',
    show_discount_by_default: false,
  };
  await db.settings.put(fallback);
  return fallback;
}

export async function updateSettings(
  updates: Partial<Omit<Settings, 'id'>>,
  applyPriceToOpenCycles = false
): Promise<void> {
  await db.transaction('rw', [db.settings, db.cycles], async () => {
    const current = await getSettings();
    const next: Settings = { ...current, ...updates, id: 1 };
    await db.settings.put(next);

    if (
      applyPriceToOpenCycles &&
      updates.default_kwh_price_agorot !== undefined
    ) {
      const openCycles = await db.cycles.where('status').equals('OPEN').toArray();
      for (const cycle of openCycles) {
        if (cycle.id !== undefined) {
          await db.cycles.update(cycle.id, {
            kwh_price_agorot: updates.default_kwh_price_agorot,
          });
        }
      }
    }
  });
}
