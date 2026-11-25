import { db } from './database';
import type { Payment } from '../types/models';

export async function addPayment(input: {
  user_id: number;
  cycle_id?: number | null;
  amount_agorot: number;
  payment_date?: string;
  notes?: string;
}): Promise<number> {
  if (input.amount_agorot <= 0) {
    throw new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر');
  }
  const id = await db.payments.add({
    user_id: input.user_id,
    cycle_id: input.cycle_id ?? null,
    amount_agorot: input.amount_agorot,
    payment_date: input.payment_date || new Date().toISOString(),
    notes: input.notes?.trim() || '',
  });
  return id as number;
}

export async function deletePayment(id: number): Promise<void> {
  await db.payments.delete(id);
}

export async function getUserPayments(userId: number): Promise<Payment[]> {
  const list = await db.payments.where('user_id').equals(userId).toArray();
  return list.sort((a, b) => b.payment_date.localeCompare(a.payment_date));
}
