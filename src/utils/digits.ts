const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to Western ASCII digits (0-9),
 * and normalizes Arabic decimal/comma separators (٫, ,) to '.'.
 */
export function normalizeDigits(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const arabicIdx = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (arabicIdx !== -1) {
      out += String(arabicIdx);
      continue;
    }
    const persianIdx = PERSIAN_DIGITS.indexOf(ch);
    if (persianIdx !== -1) {
      out += String(persianIdx);
      continue;
    }
    if (ch === '٫' || ch === ',') {
      out += '.';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Sanitizes a numeric input string so it only contains digits and at most one decimal point.
 */
export function sanitizeDecimalInput(input: string, maxDecimals = 1): string {
  const normalized = normalizeDigits(input);
  let result = '';
  let hasDot = false;
  let decimals = 0;

  for (const ch of normalized) {
    if (ch >= '0' && ch <= '9') {
      if (hasDot) {
        if (decimals < maxDecimals) {
          result += ch;
          decimals++;
        }
      } else {
        result += ch;
      }
    } else if (ch === '.' && !hasDot && maxDecimals > 0) {
      hasDot = true;
      result += result === '' ? '0.' : '.';
    }
  }
  return result;
}
