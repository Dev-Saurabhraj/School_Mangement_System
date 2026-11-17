/**
 * @file LibraryPage.spec.tsx
 * @description Component tests for the Library page: role-aware actions and the issue / return flows.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LibraryPage } from './LibraryPage';

const { mockApi, mockUser } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  mockUser: { current: { id: 'u1', name: 'Admin', role: 'SCHOOL_ADMIN' } },
}));

vi.mock('../lib/api', () => ({ api: mockApi }));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
      const { initial, animate, exit, ...rest } = props as Record<string, unknown>;
      void initial;
      void animate;
      void exit;
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const books = [
  {
    id: 'book-1',
    title: 'Concepts of Physics',
    author: 'H.C. Verma',
    isbn: '978-8177091878',
    category: 'Physics',
    shelfLocation: null,
    totalCopies: 5,
    availableCopies: 2,
  },
  {
    id: 'book-2',
    title: 'Higher Algebra',
    author: 'Hall & Knight',
    isbn: null,
    category: 'Mathematics',
    shelfLocation: null,
    totalCopies: 1,
    availableCopies: 0,
  },
];

const overdueIssue = {
  id: 'issue-1',
  issuedAt: '2026-10-01T00:00:00.000Z',
  dueDate: '2026-10-15T00:00:00.000Z',
  returnedAt: null,
  status: 'OVERDUE',
  daysOverdue: 4,
  fineAmount: 8,
  book: { id: 'book-2', title: 'Higher Algebra', author: 'Hall & Knight', isbn: null, category: 'Mathematics' },
  student: { id: 's1', admissionNo: 'ADM-2026-001', name: 'Rahul Sharma' },
};

const summary = {
  totalTitles: 2,
  totalCopies: 6,
  availableCopies: 2,
  openIssues: 1,
  overdueIssues: 1,
  categories: [
    { name: 'Mathematics', titles: 1 },
    { name: 'Physics', titles: 1 },
  ],
  policy: { maxOpenIssuesPerStudent: 3, finePerDay: 2 },
};

const meta = { page: 1, pageSize: 10, total: 2, totalPages: 1 };

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LibraryPage />
    </QueryClientProvider>
  );
};

describe('LibraryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUser.current = { id: 'u1', name: 'Admin', role: 'SCHOOL_ADMIN' };
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/library/summary') return Promise.resolve({ data: { data: summary } });
      if (url === '/library/books') return Promise.resolve({ data: { data: books, meta } });
      if (url === '/library/issues') {
        return Promise.resolve({ data: { data: [overdueIssue], meta: { ...meta, total: 1 } } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  it('renders the live catalog and summary counters', async () => {
    renderPage();

    expect(await screen.findByText('Concepts of Physics')).toBeDefined();
    expect(screen.getByText('2 / 5 Available')).toBeDefined();
    expect(screen.getByText('6 physical volumes')).toBeDefined();
    // The out-of-stock title cannot be issued.
    const outOfStock = screen.getByRole('button', { name: 'Out of Stock' }) as HTMLButtonElement;
    expect(outOfStock.disabled).toBe(true);
  });

  it('gives students a read-only catalog and their own loans', async () => {
    mockUser.current = { id: 'u2', name: 'Rahul', role: 'STUDENT' };
    renderPage();

    expect(await screen.findByText('Concepts of Physics')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Add New Book/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Issue Book' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Concepts of Physics/i })).toBeNull();
    expect(screen.getByRole('tab', { name: /My Books/i })).toBeDefined();
  });

  it('lets teachers issue books but not edit or remove titles', async () => {
    mockUser.current = { id: 'u3', name: 'Amit', role: 'TEACHER' };
    renderPage();

    expect(await screen.findByRole('button', { name: 'Issue Book' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Edit Concepts of Physics/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Concepts of Physics/i })).toBeNull();
  });

  it('issues a book by admission number and confirms the due date', async () => {
    mockApi.post.mockResolvedValue({
      data: {
        data: {
          ...overdueIssue,
          status: 'ACTIVE',
          daysOverdue: 0,
          fineAmount: 0,
          dueDate: '2026-12-01T00:00:00.000Z',
          book: { ...overdueIssue.book, id: 'book-1', title: 'Concepts of Physics' },
        },
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Issue Book' }));
    fireEvent.change(screen.getByLabelText(/Student Admission Number/i), {
      target: { value: ' ADM-2026-001 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Issue' }));

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/library/issues', {
        bookId: 'book-1',
        admissionNo: 'ADM-2026-001',
        days: 14,
      })
    );
    expect(await screen.findByText(/issued to Rahul Sharma \(ADM-2026-001\)/)).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the issue dialog open and shows the server reason when issuing fails', async () => {
    mockApi.post.mockRejectedValue({
      response: { data: { message: 'Borrowing limit reached: a student can hold 3 books at a time' } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Issue Book' }));
    fireEvent.change(screen.getByLabelText(/Student Admission Number/i), {
      target: { value: 'ADM-2026-001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Issue' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Borrowing limit reached');
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('returns an overdue book and tells staff the fine to collect', async () => {
    mockApi.post.mockResolvedValue({
      data: { data: { ...overdueIssue, status: 'RETURNED', returnedAt: '2026-10-19T00:00:00.000Z' } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Issued Register/i }));
    expect(await screen.findByText('OVERDUE · 4d')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Return Book/i }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/library/issues/issue-1/return'));
    expect(await screen.findByText(/Collect a late fine of ₹8/)).toBeDefined();
  });

  it('asks for confirmation before removing a title', async () => {
    mockApi.delete.mockResolvedValue({ data: { data: { id: 'book-1' } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Concepts of Physics' }));
    expect(mockApi.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/library/books/book-1'));
  });
});
