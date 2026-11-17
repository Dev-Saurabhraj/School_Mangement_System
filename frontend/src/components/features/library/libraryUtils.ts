/**
 * @file libraryUtils.ts
 * @description Small formatting helpers shared by the library views.
 */

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatRupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export { getApiErrorMessage } from '../../../lib/api';

export const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl bg-surface-raised border border-border text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/30 transition-all duration-200';
