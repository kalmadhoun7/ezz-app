import { normalizeDigits } from './digits';

/**
 * Parses a decimal kWh string (e.g. "1520.5" or "١٥٢٠.٥") into integer tenths (15205).
 * Returns null if invalid or empty.
 */
export function parseKwhToTenths(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 10);
  }
  const normalized = normalizeDigits(value).trim();
  if (!normalized || !/^\d+(\.\d{0,4})?$/.test(normalized)) {
    return null;
  }
  const [intPart, fracPart = ''] = normalized.split('.');
  const tenthsDigit = fracPart.length > 0 ? Number(fracPart[0]) : 0;
  const extraDigit = fracPart.length > 1 ? Number(fracPart[1]) : 0;
  const roundUp = extraDigit >= 5 ? 1 : 0;
  return Number(intPart) * 10 + tenthsDigit + roundUp;
}

/**
 * Parses a currency string (e.g. "10.50" or "١٠.٥") into integer agorot/cents (1050).
 * Returns null if invalid or empty.
 */
export function parseCurrencyToAgorot(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }
  const normalized = normalizeDigits(value).trim();
  if (!normalized || !/^\d+(\.\d{0,4})?$/.test(normalized)) {
    return null;
  }
  const [intPart, fracPart = ''] = normalized.split('.');
  const padded = (fracPart + '000').slice(0, 3);
  const cents = Number(padded.slice(0, 2));
  const roundUp = Number(padded[2]) >= 5 ? 1 : 0;
  return Number(intPart) * 100 + cents + roundUp;
}

/**
 * Calculates cost in integer agorot from consumption in integer tenths and rate in integer agorot/kWh.
 * Example: 155 tenths (15.5 kWh) * 1000 agorot (10.00 ILS) / 10 = 15500 agorot (155.00 ILS).
 */
export function computeAmountAgorot(kwhTenths: number, pricePerKwhAgorot: number): number {
  return Math.round((kwhTenths * pricePerKwhAgorot) / 10);
}

/**
 * Converts a monetary amount (agorot) into equivalent kWh tenths at a given cycle rate (agorot/kWh).
 * Example: 20000 agorot (200 ILS) / 1000 agorot (10 ILS/kWh) * 10 = 200 tenths (20.0 kWh).
 */
export function agorotToKwhTenths(amountAgorot: number, pricePerKwhAgorot: number): number {
  if (pricePerKwhAgorot <= 0) return 0;
  return Math.round((amountAgorot * 10) / pricePerKwhAgorot);
}

export interface ProportionalItem {
  id: number;
  weight: number;
}

/**
 * Distributes an integer `total` across items proportionally to their `weight`
 * using the Largest Remainder Method (Hamilton method) so that the sum of
 * returned shares equals `total` with 0 remainder.
 */
export function distributeProportionally(
  total: number,
  items: ProportionalItem[]
): Map<number, number> {
  const result = new Map<number, number>();
  if (items.length === 0) return result;
  if (total === 0) {
    for (const item of items) result.set(item.id, 0);
    return result;
  }

  const totalWeight = items.reduce((acc, item) => acc + Math.max(0, item.weight), 0);
  if (totalWeight <= 0) {
    // Equal distribution fallback if all weights are 0
    const base = Math.floor(total / items.length);
    let remainder = total - base * items.length;
    for (const item of items) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      result.set(item.id, base + extra);
    }
    return result;
  }

  const entries = items.map((item, index) => {
    const w = Math.max(0, item.weight);
    const exactNumerator = total * w;
    const base = Math.floor(exactNumerator / totalWeight);
    const remNumerator = exactNumerator % totalWeight;
    return { id: item.id, index, base, remNumerator };
  });

  let distributed = entries.reduce((acc, e) => acc + e.base, 0);
  let remaining = total - distributed;

  // Sort descending by remainder, tie-break by original order
  const sorted = [...entries].sort((a, b) => {
    if (b.remNumerator !== a.remNumerator) return b.remNumerator - a.remNumerator;
    return a.index - b.index;
  });

  for (let i = 0; i < sorted.length && remaining > 0; i++) {
    sorted[i].base += 1;
    remaining--;
  }

  for (const e of entries) {
    result.set(e.id, e.base);
  }
  return result;
}
