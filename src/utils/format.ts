/**
 * Formats integer tenths (e.g. 15205) to 1-decimal string ("1520.5").
 */
export function formatKwh(tenths: number): string {
  const sign = tenths < 0 ? '-' : '';
  const abs = Math.abs(Math.round(tenths));
  const intPart = Math.floor(abs / 10);
  const fracPart = abs % 10;
  return `${sign}${intPart}.${fracPart}`;
}

/**
 * Formats integer agorot/cents (e.g. 1050) to 2-decimal currency string ("10.50").
 */
export function formatCurrency(agorot: number): string {
  const sign = agorot < 0 ? '-' : '';
  const abs = Math.abs(Math.round(agorot));
  const intPart = Math.floor(abs / 100);
  const fracPart = String(abs % 100).padStart(2, '0');
  return `${sign}${intPart}.${fracPart}`;
}

/**
 * Formats an ISO date string into a clean Arabic date/time representation.
 */
export function formatDateTimeAr(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
}

export function formatDateAr(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Formats an ISO date string as DD/MM/YYYY with Western digits (e.g. "14/11/2026").
 */
export function formatDateSlash(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Returns local datetime-local input value (YYYY-MM-DDTHH:mm) for an ISO string or now.
 */
export function toDateTimeLocalValue(isoString?: string): string {
  const d = isoString ? new Date(isoString) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
