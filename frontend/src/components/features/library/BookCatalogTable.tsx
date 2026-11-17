/**
 * @file BookCatalogTable.tsx
 * @description Library catalog table with role-aware issue / edit / remove actions.
 */

import React, { useState } from 'react';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { LibraryBook } from '../../../types';

interface BookCatalogTableProps {
  books: LibraryBook[];
  isLoading: boolean;
  /** True when a search or category filter is narrowing the list. */
  isFiltered: boolean;
  /** Staff can issue books. */
  canIssue: boolean;
  /** Admins can edit and remove titles. */
  canAdminister: boolean;
  deletingId?: string | null;
  onIssue: (book: LibraryBook) => void;
  onEdit: (book: LibraryBook) => void;
  onDelete: (book: LibraryBook) => void;
  onAddBook: () => void;
}

const headCell = 'py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted';

export const BookCatalogTable: React.FC<BookCatalogTableProps> = ({
  books,
  isLoading,
  isFiltered,
  canIssue,
  canAdminister,
  deletingId,
  onIssue,
  onEdit,
  onDelete,
  onAddBook,
}) => {
  // Removing a title is destructive, so the first click only arms the button.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const showActions = canIssue || canAdminister;

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading catalog">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-14 rounded-2xl bg-surface-raised animate-pulse" />
        ))}
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className="py-14 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-accent-blue-subtle text-accent-blue flex items-center justify-center mb-3">
          <BookOpen className="w-7 h-7" />
        </div>
        <p className="text-sm font-bold text-primary">
          {isFiltered ? 'No books match your search' : 'The catalog is empty'}
        </p>
        <p className="text-xs text-muted mt-1">
          {isFiltered
            ? 'Try a different title, author, ISBN or category.'
            : 'Add the first title to start issuing books to students.'}
        </p>
        {!isFiltered && canIssue && (
          <button
            type="button"
            onClick={onAddBook}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-accent-blue text-white font-bold text-xs shadow-card hover:brightness-110 transition-all duration-200 cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Add New Book
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className={headCell}>Book Details</th>
            <th className={headCell}>Category</th>
            <th className={headCell}>ISBN</th>
            <th className={headCell}>Stock Status</th>
            {showActions && <th className={cn(headCell, 'text-right')}>Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {books.map((book) => {
            const inStock = book.availableCopies > 0;
            const confirming = confirmingId === book.id;

            return (
              <tr key={book.id} className="hover:bg-surface-raised/50 transition-colors duration-200">
                <td className="py-4 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent-blue-subtle text-accent-blue flex items-center justify-center shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-primary">{book.title}</p>
                      <p className="text-xs text-muted font-medium">
                        By {book.author}
                        {book.shelfLocation && ` • ${book.shelfLocation}`}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4 text-xs font-semibold text-secondary">
                  <span className="px-2.5 py-1 rounded-lg bg-surface-raised border border-border whitespace-nowrap">
                    {book.category}
                  </span>
                </td>
                <td className="py-4 px-4 text-xs font-mono text-muted whitespace-nowrap">
                  {book.isbn ?? '—'}
                </td>
                <td className="py-4 px-4">
                  <span
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap',
                      inStock
                        ? 'bg-accent-green-subtle text-accent-green'
                        : 'bg-accent-rose-subtle text-accent-rose'
                    )}
                  >
                    {book.availableCopies} / {book.totalCopies} Available
                  </span>
                </td>
                {showActions && (
                  <td className="py-4 px-4">
                    <div className="flex items-center justify-end gap-2">
                      {canIssue && (
                        <button
                          type="button"
                          onClick={() => onIssue(book)}
                          disabled={!inStock}
                          className="px-4 py-1.5 rounded-xl bg-accent-blue text-white text-xs font-bold whitespace-nowrap hover:brightness-110 transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {inStock ? 'Issue Book' : 'Out of Stock'}
                        </button>
                      )}
                      {canAdminister && (
                        <>
                          <button
                            type="button"
                            onClick={() => onEdit(book)}
                            aria-label={`Edit ${book.title}`}
                            className="p-2 rounded-xl text-muted hover:text-primary hover:bg-surface-raised transition-all duration-200 active:scale-95 cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {confirming ? (
                            <button
                              type="button"
                              autoFocus
                              onClick={() => {
                                setConfirmingId(null);
                                onDelete(book);
                              }}
                              onBlur={() => setConfirmingId(null)}
                              className="px-3 py-1.5 rounded-xl bg-accent-rose text-white text-xs font-bold whitespace-nowrap hover:brightness-110 transition-all duration-200 active:scale-95 cursor-pointer"
                            >
                              Confirm remove
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingId(book.id)}
                              disabled={deletingId === book.id}
                              aria-label={`Remove ${book.title}`}
                              className="p-2 rounded-xl text-muted hover:text-accent-rose hover:bg-accent-rose-subtle transition-all duration-200 active:scale-95 disabled:opacity-40 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
