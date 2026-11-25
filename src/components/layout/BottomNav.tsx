import React from 'react';
import {
  Home,
  PlusCircle,
  RefreshCw,
  FileBarChart2,
  Settings,
} from 'lucide-react';

export type TabKey = 'dashboard' | 'add-reading' | 'cycles' | 'reports' | 'settings';

interface BottomNavProps {
  activeTab: TabKey;
  onChangeTab: (tab: TabKey) => void;
  pendingGapsCount?: number;
}

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'dashboard', label: 'الرئيسية', icon: Home },
  { key: 'add-reading', label: 'قراءة جديدة', icon: PlusCircle },
  { key: 'cycles', label: 'الدورات', icon: RefreshCw },
  { key: 'reports', label: 'التقارير', icon: FileBarChart2 },
  { key: 'settings', label: 'الإعدادات', icon: Settings },
];

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  pendingGapsCount = 0,
}) => {
  return (
    <nav className="fixed right-0 bottom-0 left-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto grid max-w-2xl grid-cols-5">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChangeTab(key)}
              className={`relative flex min-h-[58px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold transition ${
                isActive
                  ? 'text-teal-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {isActive && (
                <span className="absolute top-0 right-3 left-3 h-0.5 rounded-full bg-teal-700" />
              )}
              <div className="relative">
                <Icon className="h-5 w-5" />
                {key === 'cycles' && pendingGapsCount > 0 && (
                  <span className="absolute -top-1.5 -left-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                    {pendingGapsCount}
                  </span>
                )}
              </div>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
