/**
 * @file library.service.ts
 * @description API service for the Library catalog and book circulation.
 */

import { api } from '../lib/api';
import type {
  BookInput,
  BookUpdateInput,
  BookIssue,
  IssueBookInput,
  LibraryBook,
  LibraryList,
  LibraryPageMeta,
  LibrarySummary,
  ListBooksParams,
  ListIssuesParams,
} from '../types';

const toPage = <T>(body: { data?: T[]; meta?: LibraryPageMeta }): LibraryList<T> => {
  const items = Array.isArray(body?.data) ? body.data : [];
  return {
    items,
    meta: body?.meta ?? { page: 1, pageSize: items.length, total: items.length, totalPages: 1 },
  };
};

/** Drop empty filters so they are not sent as blank query params. */
const clean = (params: object) =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== '')
  );

export const libraryService = {
  getBooks: async (params: ListBooksParams = {}): Promise<LibraryList<LibraryBook>> => {
    const res = await api.get('/library/books', { params: clean(params) });
    return toPage<LibraryBook>(res.data);
  },

  getSummary: async (): Promise<LibrarySummary> => {
    const res = await api.get('/library/summary');
    return res.data.data;
  },

  createBook: async (data: BookInput): Promise<LibraryBook> => {
    const res = await api.post('/library/books', clean(data));
    return res.data.data;
  },

  updateBook: async (id: string, data: BookUpdateInput): Promise<LibraryBook> => {
    const res = await api.patch(`/library/books/${id}`, data);
    return res.data.data;
  },

  deleteBook: async (id: string): Promise<void> => {
    await api.delete(`/library/books/${id}`);
  },

  getIssues: async (params: ListIssuesParams = {}): Promise<LibraryList<BookIssue>> => {
    const res = await api.get('/library/issues', { params: clean(params) });
    return toPage<BookIssue>(res.data);
  },

  issueBook: async (data: IssueBookInput): Promise<BookIssue> => {
    const res = await api.post('/library/issues', data);
    return res.data.data;
  },

  returnBook: async (issueId: string): Promise<BookIssue> => {
    const res = await api.post(`/library/issues/${issueId}/return`);
    return res.data.data;
  },
};
