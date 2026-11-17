/**
 * @file LibraryPage.tsx
 * @description Library Catalog & Book Circulation orchestrator.
 * Staff manage the catalog and issue/return books; students and parents browse
 * the catalog and track their own borrowed books.
 */

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  useDeleteBook,
  useLibraryBooks,
  useLibraryIssues,
  useLibrarySummary,
  useReturnBook,
} from '../hooks';
import {
  BookCatalogTable,
  BookFormModal,
  IssueBookModal,
  IssueRegisterTable,
  LibraryStats,
  formatRupees,
  getApiErrorMessage,
  type LibraryStat,
} from '../components/features/library';
import { cn } from '../lib/utils';
import type { BookIssue, BookIssueStatusFilter, LibraryBook, LibraryPageMeta } from '../types';

const PAGE_SIZE = 10;
const ALL = 'ALL';

type Tab = 'catalog' | 'issues';
type Toast = { kind: 'success' | 'error'; message: string };
type BookModal = { mode: 'create' } | { mode: 'edit'; book: LibraryBook } | null;

const ISSUE_FILTERS: { value: BookIssueStatusFilter | typeof ALL; label: string }[] = [
  { value: 'OPEN', label: 'Currently Issued' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'RETURNED', label: 'Returned' },
  { value: ALL, label: 'All' },
];

const pillClass = (active: boolean) =>
  cn(
    'px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-200 cursor-pointer active:scale-95',
    active
      ? 'bg-accent-blue text-white shadow-sm'
      : 'bg-surface-raised border border-border text-secondary hover:text-primary'
  );

const Pager: React.FC<{ meta?: LibraryPageMeta; onChange: (page: number) => void }> = ({ meta, onChange }) => {
  if (!meta || meta.totalPages <= 1) return null;
  const buttonClass =
    'p-2 rounded-xl border border-border text-secondary hover:text-primary hover:bg-surface-raised transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer';

  return (
    <div className="flex items-center justify-between pt-2 text-xs text-muted">
      <span>
        Page {meta.page} of {meta.totalPages} • {meta.total} records
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={meta.page <= 1}
          onClick={() => onChange(meta.page - 1)}
          className={buttonClass}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onChange(meta.page + 1)}
          className={buttonClass}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const LibraryPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === 'SCHOOL_ADMIN' || role === 'SUPER_ADMIN';
  const isStaff = isAdmin || role === 'TEACHER';

  const [activeTab, setActiveTab] = useState<Tab>('catalog');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL);
  const [bookPage, setBookPage] = useState(1);
  const [issueFilter, setIssueFilter] = useState<BookIssueStatusFilter | typeof ALL>('OPEN');
  const [issuePage, setIssuePage] = useState(1);

  const [bookModal, setBookModal] = useState<BookModal>(null);
  const [bookToIssue, setBookToIssue] = useState<LibraryBook | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Debounce typing so each keystroke does not hit the API.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setBookPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const summaryQuery = useLibrarySummary();
  const booksQuery = useLibraryBooks({
    search: search || undefined,
    category: category === ALL ? undefined : category,
    page: bookPage,
    pageSize: PAGE_SIZE,
  });
  const issuesQuery = useLibraryIssues({
    status: issueFilter === ALL ? undefined : issueFilter,
    page: issuePage,
    pageSize: PAGE_SIZE,
  });
  // Borrowers get their own open-loan counters; the API scopes this to the viewer.
  const myOpenIssuesQuery = useLibraryIssues({ status: 'OPEN', page: 1, pageSize: 100 }, !isStaff);

  const deleteBook = useDeleteBook();
  const returnBook = useReturnBook();

  const summary = summaryQuery.data;
  const books = booksQuery.data?.items ?? [];
  const issues = issuesQuery.data?.items ?? [];
  const myOpenIssues = myOpenIssuesQuery.data?.items ?? [];
  const openIssueCount = isStaff ? summary?.openIssues ?? 0 : myOpenIssuesQuery.data?.meta.total ?? 0;

  const success = (message: string) => setToast({ kind: 'success', message });
  const failure = (error: unknown, fallback: string) =>
    setToast({ kind: 'error', message: getApiErrorMessage(error, fallback) });

  const handleDelete = (book: LibraryBook) =>
    deleteBook.mutate(book.id, {
      onSuccess: () => success(`"${book.title}" removed from the catalog.`),
      onError: (error) => failure(error, 'Could not remove this book.'),
    });

  const handleReturn = (issue: BookIssue) =>
    returnBook.mutate(issue.id, {
      onSuccess: (returned) =>
        success(
          returned.fineAmount > 0
            ? `"${returned.book.title}" returned. Collect a late fine of ${formatRupees(returned.fineAmount)}.`
            : `"${returned.book.title}" returned. Stock restored.`
        ),
      onError: (error) => failure(error, 'Could not return this book.'),
    });

  const stats: LibraryStat[] = [
    {
      label: 'Total Titles',
      value: summary?.totalTitles ?? 0,
      hint: `${summary?.totalCopies ?? 0} physical volumes`,
    },
    {
      label: 'Available on Shelf',
      value: summary?.availableCopies ?? 0,
      hint: 'Ready for checkout',
      tone: 'green',
    },
    isStaff
      ? { label: 'Books Issued', value: summary?.openIssues ?? 0, hint: 'Currently with students', tone: 'blue' }
      : { label: 'Borrowed Now', value: openIssueCount, hint: 'Books to return', tone: 'blue' },
    isStaff
      ? { label: 'Overdue', value: summary?.overdueIssues ?? 0, hint: 'Past the return date', tone: 'rose' }
      : {
          label: 'Overdue',
          value: myOpenIssues.filter((issue) => issue.status === 'OVERDUE').length,
          hint: 'Return these to stop the fine',
          tone: 'rose',
        },
  ];

  const issuesTabLabel = isStaff ? 'Issued Register' : role === 'PARENT' ? "Children's Books" : 'My Books';
  const loadError = booksQuery.isError || summaryQuery.isError || issuesQuery.isError;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={cn(
              'p-3.5 rounded-2xl border text-xs font-semibold flex items-center gap-2 shadow-sm',
              toast.kind === 'success'
                ? 'bg-accent-green-subtle text-accent-green border-accent-green/20'
                : 'bg-accent-rose-subtle text-accent-rose border-accent-rose/20'
            )}
          >
            {toast.kind === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            {isStaff ? 'Library Catalog & Book Issues' : 'School Library'}
          </h1>
          <p className="text-sm text-secondary">
            {isStaff
              ? 'Search library inventory, issue books to students, and track return due dates.'
              : 'Browse the catalog and keep track of borrowed books and return dates.'}
          </p>
        </div>
        {isStaff && (
          <button
            type="button"
            onClick={() => setBookModal({ mode: 'create' })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-accent-blue text-white font-bold text-xs shadow-card hover:brightness-110 transition-all duration-200 cursor-pointer active:scale-95 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Add New Book
          </button>
        )}
      </div>

      {loadError && (
        <div role="alert" className="p-3.5 rounded-2xl bg-accent-rose-subtle text-accent-rose border border-accent-rose/20 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Could not load library data. Check your connection and try again.
        </div>
      )}

      <LibraryStats stats={stats} isLoading={summaryQuery.isLoading} />

      <div className="bg-surface rounded-3xl p-6 border border-border shadow-card space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex p-1 rounded-2xl bg-surface-raised border border-border text-xs font-semibold w-fit" role="tablist">
            {(['catalog', 'issues'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-2 rounded-xl transition-all duration-200 flex items-center gap-1.5 cursor-pointer',
                  activeTab === tab
                    ? 'bg-surface text-accent-blue font-bold shadow-sm'
                    : 'text-secondary hover:text-primary'
                )}
              >
                {tab === 'catalog' ? `Book Catalog (${summary?.totalTitles ?? 0})` : issuesTabLabel}
                {tab === 'issues' && (
                  <span className="px-1.5 rounded-full text-[10px] bg-accent-blue-subtle text-accent-blue font-bold">
                    {openIssueCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {activeTab === 'catalog' && (
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Search books"
                placeholder="Search by title, author, or ISBN..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-surface-raised border border-border rounded-xl text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/30 transition-all duration-200"
              />
            </div>
          )}
        </div>

        {activeTab === 'catalog' ? (
          <>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {[ALL, ...(summary?.categories.map((c) => c.name) ?? [])].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setCategory(name);
                    setBookPage(1);
                  }}
                  className={pillClass(category === name)}
                >
                  {name}
                </button>
              ))}
            </div>

            <BookCatalogTable
              books={books}
              isLoading={booksQuery.isLoading}
              isFiltered={Boolean(search) || category !== ALL}
              canIssue={isStaff}
              canAdminister={isAdmin}
              deletingId={deleteBook.isPending ? deleteBook.variables : null}
              onIssue={setBookToIssue}
              onEdit={(book) => setBookModal({ mode: 'edit', book })}
              onDelete={handleDelete}
              onAddBook={() => setBookModal({ mode: 'create' })}
            />
            <Pager meta={booksQuery.data?.meta} onChange={setBookPage} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {ISSUE_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => {
                    setIssueFilter(filter.value);
                    setIssuePage(1);
                  }}
                  className={pillClass(issueFilter === filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <IssueRegisterTable
              issues={issues}
              isLoading={issuesQuery.isLoading}
              canReturn={isStaff}
              showStudent={role !== 'STUDENT'}
              returningId={returnBook.isPending ? returnBook.variables : null}
              onReturn={handleReturn}
            />
            <Pager meta={issuesQuery.data?.meta} onChange={setIssuePage} />
          </>
        )}
      </div>

      {bookModal && (
        <BookFormModal
          book={bookModal.mode === 'edit' ? bookModal.book : null}
          categories={summary?.categories.map((c) => c.name) ?? []}
          onClose={() => setBookModal(null)}
          onSaved={success}
        />
      )}

      {bookToIssue && (
        <IssueBookModal
          book={bookToIssue}
          policy={summary?.policy}
          onClose={() => setBookToIssue(null)}
          onIssued={success}
        />
      )}
    </div>
  );
};

export default LibraryPage;
