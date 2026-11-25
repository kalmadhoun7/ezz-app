import React from 'react';
import { sanitizeDecimalInput } from '../../utils/digits';

interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  maxDecimals?: number;
  label?: string;
  suffix?: string;
}

export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  onChange,
  maxDecimals = 1,
  label,
  suffix,
  className = '',
  id,
  ...rest
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeDecimalInput(e.target.value, maxDecimals);
    onChange(sanitized);
  };

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={value}
          onChange={handleChange}
          className={`min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-right text-base font-semibold tabular-nums text-slate-900 shadow-xs transition focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 focus:outline-none ${
            suffix ? 'pl-14' : ''
          } ${className}`}
          {...rest}
        />
        {suffix && (
          <span className="pointer-events-none absolute left-3 text-xs font-semibold text-slate-500">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
};
