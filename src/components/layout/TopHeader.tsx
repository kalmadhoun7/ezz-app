import React from 'react';
import { Zap } from 'lucide-react';
import type { Meter } from '../../types/models';

interface TopHeaderProps {
  mainMeters: Meter[];
  activeMeterId: number | null;
  onSelectMeter: (id: number) => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  mainMeters,
  activeMeterId,
  onSelectMeter,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-teal-700 text-white shadow-sm">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
            <Zap className="h-5 w-5 text-teal-200" />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight">دفتر العداد المشترك</h1>
            <p className="text-[11px] text-teal-100">يعمل أوفلاين 100%</p>
          </div>
        </div>

        {mainMeters.length > 0 && (
          <select
            aria-label="اختيار العداد الرئيسي النشط"
            value={activeMeterId ?? ''}
            onChange={(e) => onSelectMeter(Number(e.target.value))}
            className="min-h-[44px] max-w-[180px] rounded-xl border border-teal-500 bg-teal-800/80 px-3 py-1.5 text-sm font-semibold text-white focus:border-white focus:outline-none"
          >
            {mainMeters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </header>
  );
};
