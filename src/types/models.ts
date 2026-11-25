export type MeterType = 'MAIN' | 'SUB';
export type CycleStatus = 'OPEN' | 'CLOSED';
export type PendingGapStatus = 'PENDING' | 'RESOLVED' | 'KEPT_AS_LOSS';
export type InvoiceMode = 'COMPACT' | 'DETAILED';
export type SnapshotType = 'PRE_CLOSE_ORIGINAL';

export interface Settings {
  id: number; // Always 1
  default_kwh_price_agorot: number; // e.g., 10.00 ILS = 1000
  currency_symbol: string; // e.g., 'شيكل' or '₪'
  anomaly_threshold_tenths: number; // e.g., 100.0 kWh = 1000
  default_invoice_mode: InvoiceMode;
  show_discount_by_default: boolean;
}

export interface Meter {
  id?: number;
  name: string;
  type: MeterType;
  parent_meter_id: number | null;
  default_user_id: number | null;
  is_active: boolean;
  created_at: string; // ISO string
}

export interface User {
  id?: number;
  name: string; // unique
  whatsapp_phone: string | null;
  notes: string;
  is_active: boolean;
  created_at: string;
}

export interface Cycle {
  id?: number;
  meter_id: number; // Main meter ID
  title: string;
  start_date: string; // ISO string
  end_date: string | null;
  opening_reading_tenths: number;
  closing_reading_tenths: number | null;
  kwh_price_agorot: number; // Snapshot of rate for this cycle
  status: CycleStatus;
  bill_prev_tenths: number | null;
  bill_curr_tenths: number | null;
  bill_kwh_tenths: number | null;
  bill_amount_agorot: number | null;
  unallocated_loss_tenths: number;
  surcharge_agorot: number;
  closed_at: string | null;
}

export interface Reading {
  id?: number;
  cycle_id: number;
  meter_id: number;
  user_id: number;
  prev_reading_tenths: number;
  curr_reading_tenths: number;
  consumption_tenths: number; // curr - prev (integer tenths)
  recorded_at: string; // ISO string
  notes: string;
  linked_sub_reading_id: number | null; // On MAIN reading, points to SUB reading id
  is_system_generated_from_loss: boolean; // Internal admin-only flag
  sequence_order: number;
}

export interface PendingGap {
  id?: number;
  cycle_id: number;
  meter_id: number;
  from_reading_tenths: number;
  to_reading_tenths: number;
  gap_tenths: number;
  detected_at: string;
  status: PendingGapStatus;
  resolved_note: string;
}

export interface CycleUserAdjustment {
  id?: number;
  cycle_id: number;
  user_id: number;
  discount_kwh_tenths: number;
  surcharge_agorot: number;
}

export interface Payment {
  id?: number;
  user_id: number;
  cycle_id: number | null;
  amount_agorot: number;
  payment_date: string;
  notes: string;
}

export interface CycleSnapshotPayload {
  readings: Reading[];
  pending_gaps: PendingGap[];
  carried_over_reading_ids?: number[];
  split_reading_info?: {
    original_reading_id: number;
    new_cycle_reading_id: number;
  }[];
}

export interface CycleSnapshot {
  id?: number;
  cycle_id: number;
  snapshot_type: SnapshotType;
  payload_json: string;
  created_at: string;
}
