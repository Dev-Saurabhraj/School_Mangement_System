/**
 * @file IssueRegisterTable.tsx
 * @description Register of issued books with due dates, late fines and the return action.
 */

import React from 'react';
import { Check, ClipboardList, RotateCcw } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { BookIssue, BookIssueStatus } from '../../../types';
import { formatDate, formatRupees } from './libraryUtils';

interface IssueRegisterTableProps {
  issues: BookIssue[];
  isLoading: boolean;
  /** Staff can take books back. */
  canReturn: boolean;
  /** Hide the borrower column when a student is looking at their own loans. */
  showStudent: boolean;
  returningId?: string | null;
  onReturn: (issue: BookIssue) => void;
}

const headCell = 'py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted';

const statusClass: Record<BookIssueStatus, string> = {
  ACTIVE: 'bg-accent-blue-subtle text-accent-blue',
  OVERDUE: 'bg-accent-rose-subtle text-accent-rose',
  RETURNED: 'bg-surface-raised text-muted border border-border',
};

export const IssueRegisterTable: React.FC<IssueRegisterTableProps> = ({
  issues,
  isLoading,
  canReturn,
  showStudent,
  returningId,
  onReturn,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading issue register">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-14 rounded-2xl bg-surface-raised animate-pulse" />
        ))}
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="py-14 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-accent-blue-subtle text-accent-blue flex items-center justify-center mb-3">
          <ClipboardList className="w-7 h-7" />
        </div>
        <p className="text-sm font-bold text-primary">No books to show here</p>
        <p className="text-xs text-muted mt-1">
          {canReturn
            ? 'Issue a book from the catalog and it will appear in this register.'
            : 'Borrowed books and their return dates will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-border">
            {showStudent && <th className={headCell}>Student</th>}
            <th className={headCell}>Book</th>
            <th className={headCell}>Issued</th>
            <th className={headCell}>Due</th>
            <th className={headCell}>Status</th>
            <th className={headCell}>Late Fine</th>
            {canReturn && <th className={cn(headCell, 'text-right')}>Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {issues.map((issue) => (
            <tr key={issue.id} className="hover:bg-surface-raised/50 transition-colors duration-200">
              {showStudent && (
                <td className="py-4 px-4">
                  <p className="font-bold text-xs text-primary">{issue.student.name}</p>
                  <p className="text-[11px] text-muted font-mono">{issue.student.admissionNo}</p>
                </td>
              )}
              <td className="py-4 px-4">
                <p className="text-xs font-semibold text-primary">{issue.book.title}</p>
                <p className="text-[11px] text-muted">By {issue.book.author}</p>
              </td>
              <td className="py-4 px-4 text-xs text-muted whitespace-nowrap">{formatDate(issue.issuedAt)}</td>
              <td className="py-4 px-4 text-xs font-medium text-primary whitespace-nowrap">
                {formatDate(issue.dueDate)}
              </td>
              <td className="py-4 px-4">
                <span
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap',
                    statusClass[issue.status]
                  )}
                >
                  {issue.status === 'OVERDUE'
                    ? `OVERDUE · ${issue.daysOverdue}d`
                    : issue.status}
                </span>
              </td>
              <td
                className={cn(
                  'py-4 px-4 text-xs font-semibold whitespace-nowrap',
                  issue.fineAmount > 0 ? 'text-accent-rose' : 'text-muted'
                )}
              >
                {issue.fineAmount > 0 ? formatRupees(issue.fineAmount) : '—'}
              </td>
              {canReturn && (
                <td className="py-4 px-4 text-right">
                  {issue.status === 'RETURNED' ? (
                    <span className="text-[11px] text-muted inline-flex items-center gap-1 whitespace-nowrap">
                      <Check className="w-3.5 h-3.5 text-accent-green" />
                      {issue.returnedAt ? formatDate(issue.returnedAt) : 'Returned'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onReturn(issue)}
                      disabled={returningId === issue.id}
                      className="px-3 py-1.5 rounded-xl bg-accent-green-subtle text-accent-green text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5 hover:brightness-95 transition-all duration-200 active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw className={cn('w-3.5 h-3.5', returningId === issue.id && 'animate-spin')} />
                      Return Book
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
