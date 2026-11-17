/**
 * @file library.types.ts
 * @description Domain types for the Library catalog and book circulation.
 */

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string;
  shelfLocation: string | null;
  totalCopies: number;
  availableCopies: number;
}

export type BookIssueStatus = 'ACTIVE' | 'OVERDUE' | 'RETURNED';
/** OPEN = still out (ACTIVE or OVERDUE). */
export type BookIssueStatusFilter = BookIssueStatus | 'OPEN';

export interface BookIssue {
  id: string;
  issuedAt: string;
  dueDate: string;
  returnedAt: string | null;
  status: BookIssueStatus;
  daysOverdue: number;
  /** Charged fine once returned; running estimate while the book is still out. */
  fineAmount: number;
  book: Pick<LibraryBook, 'id' | 'title' | 'author' | 'isbn' | 'category'>;
  student: { id: string; admissionNo: string; name: string };
}

export interface LibrarySummary {
  totalTitles: number;
  totalCopies: number;
  availableCopies: number;
  openIssues: number;
  overdueIssues: number;
  categories: { name: string; titles: number }[];
  policy: { maxOpenIssuesPerStudent: number; finePerDay: number };
}

export interface LibraryPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface LibraryList<T> {
  items: T[];
  meta: LibraryPageMeta;
}

export interface ListBooksParams {
  search?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}

export interface ListIssuesParams {
  status?: BookIssueStatusFilter;
  page?: number;
  pageSize?: number;
}

export interface BookInput {
  title: string;
  author: string;
  isbn?: string;
  category: string;
  shelfLocation?: string;
  totalCopies: number;
}

/** PATCH payload: optional text fields are cleared with null. */
export type BookUpdateInput = Partial<Omit<BookInput, 'isbn' | 'shelfLocation'>> & {
  isbn?: string | null;
  shelfLocation?: string | null;
};

export interface IssueBookInput {
  bookId: string;
  admissionNo: string;
  days: number;
}
