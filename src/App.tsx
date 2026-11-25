import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureInitialData } from './db/database';
import type { Cycle, PendingGap, Reading } from './types/models';
import { TopHeader } from './components/layout/TopHeader';
import { BottomNav, type TabKey } from './components/layout/BottomNav';
import { DashboardTab } from './components/dashboard/DashboardTab';
import { AddReadingTab } from './components/readings/AddReadingTab';
import { CyclesTab } from './components/cycles/CyclesTab';
import { OpenCycleModal } from './components/cycles/OpenCycleModal';
import { ClosingWizardModal } from './components/cycles/ClosingWizardModal';
import { ReportsTab } from './components/reports/ReportsTab';
import { UsersAndSettingsTab } from './components/settings/UsersAndSettingsTab';

export function App() {
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [activeMeterId, setActiveMeterId] = useState<number | null>(null);
  const [openCycleModalOpen, setOpenCycleModalOpen] = useState(false);
  const [closingWizardOpen, setClosingWizardOpen] = useState(false);
  const [preselectedUserId, setPreselectedUserId] = useState<number | null>(null);

  useEffect(() => {
    ensureInitialData().then(() => setReady(true));
  }, []);

  const settings = useLiveQuery(() => db.settings.get(1));
  const allMeters = useLiveQuery(() => db.meters.toArray()) ?? [];
  const mainMeters = allMeters.filter((m) => m.type === 'MAIN' && m.is_active);
  const users =
    useLiveQuery(() => db.users.filter((u) => u.is_active).toArray()) ?? [];

  useEffect(() => {
    if (mainMeters.length > 0 && (activeMeterId === null || !mainMeters.some((m) => m.id === activeMeterId))) {
      setActiveMeterId(mainMeters[0].id!);
    }
  }, [mainMeters, activeMeterId]);

  const activeMainMeter = mainMeters.find((m) => m.id === activeMeterId);
  const subMeters = allMeters.filter(
    (m) => m.type === 'SUB' && m.is_active && m.parent_meter_id === activeMeterId
  );

  const meterCycles =
    useLiveQuery<Cycle[]>(
      () =>
        activeMeterId !== null
          ? db.cycles.where('meter_id').equals(activeMeterId).toArray()
          : Promise.resolve([] as Cycle[]),
      [activeMeterId]
    ) ?? [];

  const openCycle = meterCycles.find((c) => c.status === 'OPEN');
  const closedCycles = meterCycles
    .filter((c) => c.status === 'CLOSED')
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));

  const openCycleMainReadings =
    useLiveQuery<Reading[]>(
      () =>
        openCycle?.id !== undefined && activeMeterId !== null
          ? db.readings
              .where('cycle_id')
              .equals(openCycle.id)
              .filter((r) => r.meter_id === activeMeterId)
              .toArray()
              .then((arr) =>
                arr.sort(
                  (a, b) => a.sequence_order - b.sequence_order || (a.id ?? 0) - (b.id ?? 0)
                )
              )
          : Promise.resolve([] as Reading[]),
      [openCycle?.id, activeMeterId]
    ) ?? [];

  const pendingGaps =
    useLiveQuery<PendingGap[]>(
      () =>
        openCycle?.id !== undefined
          ? db.pending_gaps
              .where('cycle_id')
              .equals(openCycle.id)
              .filter((g) => g.status === 'PENDING')
              .toArray()
          : Promise.resolve([] as PendingGap[]),
      [openCycle?.id]
    ) ?? [];

  if (!ready || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-bold text-slate-600">
        جارٍ تهيئة قاعدة البيانات المحلية...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <TopHeader
        mainMeters={mainMeters}
        activeMeterId={activeMeterId}
        onSelectMeter={setActiveMeterId}
      />

      <main className="mx-auto max-w-2xl px-4 py-4">
        {activeTab === 'dashboard' && (
          <DashboardTab
            activeMainMeter={activeMainMeter}
            openCycle={openCycle}
            readings={openCycleMainReadings}
            pendingGaps={pendingGaps}
            users={users}
            settings={settings}
            onAddReadingClick={(uid) => {
              setPreselectedUserId(uid ?? null);
              setActiveTab('add-reading');
            }}
            onOpenCycleClick={() => setOpenCycleModalOpen(true)}
            onGoToCycles={() => setActiveTab('cycles')}
          />
        )}

        {activeTab === 'add-reading' && (
          <AddReadingTab
            activeMainMeter={activeMainMeter}
            subMeters={subMeters}
            openCycle={openCycle}
            users={users}
            settings={settings}
            preselectedUserId={preselectedUserId}
            onReadingSaved={() => {}}
            onGoToCycles={() => setActiveTab('cycles')}
            onGoToSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'cycles' && (
          <CyclesTab
            openCycle={openCycle}
            closedCycles={closedCycles}
            readings={openCycleMainReadings}
            pendingGaps={pendingGaps}
            users={users}
            settings={settings}
            onOpenCycleClick={() => setOpenCycleModalOpen(true)}
            onStartClosingWizard={() => setClosingWizardOpen(true)}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsTab
            activeMainMeter={activeMainMeter}
            cycles={meterCycles}
            users={users}
            settings={settings}
          />
        )}

        {activeTab === 'settings' && (
          <UsersAndSettingsTab
            users={users}
            allMeters={allMeters}
            settings={settings}
          />
        )}
      </main>

      <BottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        pendingGapsCount={pendingGaps.length}
      />

      <OpenCycleModal
        open={openCycleModalOpen}
        onClose={() => setOpenCycleModalOpen(false)}
        mainMeter={activeMainMeter}
        settings={settings}
        onOpened={() => setActiveTab('dashboard')}
      />

      {openCycle && (
        <ClosingWizardModal
          open={closingWizardOpen}
          onClose={() => setClosingWizardOpen(false)}
          cycle={openCycle}
          readings={openCycleMainReadings}
          pendingGaps={pendingGaps}
          users={users}
          settings={settings}
          onClosed={() => setClosingWizardOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
