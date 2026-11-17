/**
 * @file IssueBookModal.tsx
 * @description Modal for issuing a catalog copy to a student by admission number.
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, BookOpen, X } from 'lucide-react';
import { useIssueBook } from '../../../hooks';
import type { LibraryBook, LibrarySummary } from '../../../types';
import { formatDate, getApiErrorMessage, inputClass } from './libraryUtils';

const BORROW_PERIODS = [
  { days: 7, label: '7 Days (1 week standard)' },
  { days: 14, label: '14 Days (2 weeks exam preparation)' },
  { days: 30, label: '30 Days (term reference)' },
];

interface IssueBookModalProps {
  book: LibraryBook;
  policy?: LibrarySummary['policy'];
  onClose: () => void;
  onIssued: (message: string) => void;
}

export const IssueBookModal: React.FC<IssueBookModalProps> = ({ book, policy, onClose, onIssued }) => {
  const issueBook = useIssueBook();
  const [admissionNo, setAdmissionNo] = useState('');
  const [days, setDays] = useState(14);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    issueBook.mutate(
      { bookId: book.id, admissionNo: admissionNo.trim(), days },
      {
        onSuccess: (issue) => {
          onIssued(
            `"${issue.book.title}" issued to ${issue.student.name} (${issue.student.admissionNo}). Due ${formatDate(issue.dueDate)}.`
          );
          onClose();
        },
        onError: (err) => setError(getApiErrorMessage(err, 'Could not issue this book.')),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-book-title"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-surface rounded-3xl p-6 border border-border shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h3 id="issue-book-title" className="font-bold text-base text-primary flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-accent-blue" />
            Issue Book to Student
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-xl text-muted hover:text-primary hover:bg-surface-raised transition-all duration-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 rounded-2xl bg-accent-blue-subtle border border-accent-blue/20 text-xs">
          <p className="font-bold text-primary">{book.title}</p>
          <p className="text-muted mt-0.5">
            By {book.author} • {book.availableCopies} of {book.totalCopies} copies available
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label htmlFor="issue-admission-no" className="font-bold text-secondary block mb-1">
              Student Admission Number *
            </label>
            <input
              id="issue-admission-no"
              type="text"
              required
              autoFocus
              maxLength={40}
              placeholder="e.g. ADM-2026-001"
              value={admissionNo}
              onChange={(e) => setAdmissionNo(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="issue-days" className="font-bold text-secondary block mb-1">Borrow Duration</label>
            <select
              id="issue-days"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className={inputClass}
            >
              {BORROW_PERIODS.map((period) => (
                <option key={period.days} value={period.days}>
                  {period.label}
                </option>
              ))}
            </select>
          </div>

          {policy && (
            <p className="text-[11px] text-muted">
              Up to {policy.maxOpenIssuesPerStudent} books per student at a time. Late returns are fined ₹
              {policy.finePerDay} per day.
            </p>
          )}

          {error && (
            <p role="alert" className="p-2.5 rounded-xl bg-accent-rose-subtle text-accent-rose font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-surface-raised text-secondary font-bold border border-border hover:text-primary transition-all duration-200 active:scale-95 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={issueBook.isPending}
              className="flex-1 py-2.5 rounded-xl bg-accent-blue text-white font-bold hover:brightness-110 transition-all duration-200 active:scale-95 disabled:opacity-60 cursor-pointer"
            >
              {issueBook.isPending ? 'Issuing…' : 'Confirm Issue'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
