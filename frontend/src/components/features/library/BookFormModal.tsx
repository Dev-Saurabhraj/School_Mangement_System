/**
 * @file BookFormModal.tsx
 * @description Modal for adding a title to the catalog or editing an existing one.
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, BookOpen, X } from 'lucide-react';
import { useCreateBook, useUpdateBook } from '../../../hooks';
import type { LibraryBook } from '../../../types';
import { getApiErrorMessage, inputClass } from './libraryUtils';

const DEFAULT_CATEGORIES = [
  'General',
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Literature',
  'Computer Science',
  'Social Science',
];

interface BookFormModalProps {
  /** When set, the modal edits this book instead of creating a new one. */
  book?: LibraryBook | null;
  /** Categories already used in this school's catalog, offered as suggestions. */
  categories: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

export const BookFormModal: React.FC<BookFormModalProps> = ({ book, categories, onClose, onSaved }) => {
  const createBook = useCreateBook();
  const updateBook = useUpdateBook();
  const isEdit = Boolean(book);
  const saving = createBook.isPending || updateBook.isPending;

  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [category, setCategory] = useState(book?.category ?? 'General');
  const [isbn, setIsbn] = useState(book?.isbn ?? '');
  const [shelfLocation, setShelfLocation] = useState(book?.shelfLocation ?? '');
  const [totalCopies, setTotalCopies] = useState(book?.totalCopies ?? 5);
  const [error, setError] = useState<string | null>(null);

  const onLoan = book ? book.totalCopies - book.availableCopies : 0;
  const categoryOptions = Array.from(new Set([...categories, ...DEFAULT_CATEGORIES]));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const callbacks = {
      onSuccess: () => {
        onSaved(isEdit ? `"${title.trim()}" updated.` : `"${title.trim()}" added to the library catalog.`);
        onClose();
      },
      onError: (err: unknown) => setError(getApiErrorMessage(err, 'Could not save this book.')),
    };

    if (book) {
      updateBook.mutate(
        {
          id: book.id,
          data: {
            title,
            author,
            category,
            totalCopies,
            isbn: isbn.trim() || null,
            shelfLocation: shelfLocation.trim() || null,
          },
        },
        callbacks
      );
    } else {
      createBook.mutate({ title, author, category, totalCopies, isbn, shelfLocation }, callbacks);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-form-title"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-surface rounded-3xl p-6 border border-border shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h3 id="book-form-title" className="font-bold text-base text-primary flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-accent-blue" />
            {isEdit ? 'Edit Book' : 'Add New Book to Library'}
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

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label htmlFor="book-title" className="font-bold text-secondary block mb-1">Book Title *</label>
            <input
              id="book-title"
              type="text"
              required
              maxLength={200}
              placeholder="e.g. Problems in General Physics"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="book-author" className="font-bold text-secondary block mb-1">Author Name *</label>
            <input
              id="book-author"
              type="text"
              required
              maxLength={150}
              placeholder="e.g. I.E. Irodov"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="book-category" className="font-bold text-secondary block mb-1">Category</label>
              <input
                id="book-category"
                type="text"
                required
                maxLength={60}
                list="book-category-options"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              />
              <datalist id="book-category-options">
                {categoryOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="book-copies" className="font-bold text-secondary block mb-1">Total Copies</label>
              <input
                id="book-copies"
                type="number"
                required
                min={Math.max(1, onLoan)}
                max={1000}
                value={totalCopies}
                onChange={(e) => setTotalCopies(Number(e.target.value))}
                className={inputClass}
              />
            </div>
          </div>
          {onLoan > 0 && (
            <p className="text-[11px] text-muted">
              {onLoan} cop{onLoan === 1 ? 'y is' : 'ies are'} currently issued, so the total cannot go below that.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="book-isbn" className="font-bold text-secondary block mb-1">ISBN (Optional)</label>
              <input
                id="book-isbn"
                type="text"
                minLength={5}
                maxLength={20}
                placeholder="e.g. 978-8123900147"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="book-shelf" className="font-bold text-secondary block mb-1">Shelf (Optional)</label>
              <input
                id="book-shelf"
                type="text"
                maxLength={60}
                placeholder="e.g. Rack B-12"
                value={shelfLocation}
                onChange={(e) => setShelfLocation(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

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
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-accent-blue text-white font-bold hover:brightness-110 transition-all duration-200 active:scale-95 disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add to Catalog'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
