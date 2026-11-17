/**
 * @file library.service.spec.ts
 * @description Unit tests for the Library catalog and circulation service (Prisma mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    libraryBook: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    bookIssue: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    student: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

import { prisma } from '../../db/prisma.js';
import {
  FINE_PER_DAY,
  LibraryService,
  MAX_OPEN_ISSUES_PER_STUDENT,
  calculateFine,
} from './library.service.js';

const db = vi.mocked(prisma, true);

const SCHOOL = 'school-1';
const NOW = new Date('2026-11-17T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const book = {
  id: 'book-1',
  schoolId: SCHOOL,
  title: 'Concepts of Physics',
  author: 'H.C. Verma',
  isbn: '978-8177091878',
  category: 'Physics',
  shelfLocation: null,
  totalCopies: 5,
  availableCopies: 2,
};

const student = { id: 'student-1', userId: 'user-9', status: 'ACTIVE' };

const issueRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'issue-1',
  schoolId: SCHOOL,
  bookId: book.id,
  studentId: student.id,
  issuedAt: NOW,
  dueDate: new Date(NOW.getTime() + 14 * DAY_MS),
  returnedAt: null,
  fineAmount: 0,
  book: { id: book.id, title: book.title, author: book.author, isbn: book.isbn, category: book.category },
  student: { id: student.id, admissionNo: 'ADM-2026-001', firstName: 'Rahul', lastName: 'Sharma' },
  ...overrides,
});

describe('LibraryService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Run interactive transactions against the same mocked client.
    db.$transaction.mockImplementation(((run: (tx: typeof prisma) => unknown) => run(prisma)) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateFine', () => {
    it('charges nothing on or before the due date', () => {
      expect(calculateFine(NOW, NOW)).toBe(0);
      expect(calculateFine(NOW, new Date(NOW.getTime() - DAY_MS))).toBe(0);
    });

    it('charges per started day once overdue', () => {
      expect(calculateFine(NOW, new Date(NOW.getTime() + 1))).toBe(FINE_PER_DAY);
      expect(calculateFine(NOW, new Date(NOW.getTime() + 3 * DAY_MS))).toBe(3 * FINE_PER_DAY);
    });
  });

  describe('listBooks', () => {
    it('scopes the catalog to the tenant and paginates', async () => {
      db.libraryBook.findMany.mockResolvedValue([book] as never);
      db.libraryBook.count.mockResolvedValue(41 as never);

      const result = await LibraryService.listBooks(SCHOOL, {
        search: 'verma',
        category: 'Physics',
        availableOnly: true,
        page: 2,
        pageSize: 20,
      });

      const args = db.libraryBook.findMany.mock.calls[0][0]!;
      expect(args.where).toMatchObject({
        schoolId: SCHOOL,
        category: 'Physics',
        availableCopies: { gt: 0 },
      });
      expect(args.where!.OR).toHaveLength(3);
      expect(args).toMatchObject({ skip: 20, take: 20 });
      expect(result.meta).toEqual({ page: 2, pageSize: 20, total: 41, totalPages: 3 });
    });
  });

  describe('createBook', () => {
    it('puts every copy on the shelf for a new title', async () => {
      db.libraryBook.findFirst.mockResolvedValue(null);
      db.libraryBook.create.mockResolvedValue(book as never);

      await LibraryService.createBook(SCHOOL, {
        title: 'Concepts of Physics',
        author: 'H.C. Verma',
        isbn: '978-8177091878',
        category: 'Physics',
        totalCopies: 5,
      });

      expect(db.libraryBook.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ schoolId: SCHOOL, totalCopies: 5, availableCopies: 5 }),
      });
    });

    it('rejects a duplicate ISBN within the same school', async () => {
      db.libraryBook.findFirst.mockResolvedValue({ id: 'other' } as never);

      await expect(
        LibraryService.createBook(SCHOOL, {
          title: 'Dup',
          author: 'Someone',
          isbn: '978-8177091878',
          category: 'Physics',
          totalCopies: 1,
        })
      ).rejects.toMatchObject({ statusCode: 409, errorCode: 'DUPLICATE_ISBN' });
      expect(db.libraryBook.create).not.toHaveBeenCalled();
    });
  });

  describe('updateBook', () => {
    it('returns 404 for a book in another tenant', async () => {
      db.libraryBook.findFirst.mockResolvedValue(null);

      await expect(
        LibraryService.updateBook(SCHOOL, 'book-x', { title: 'New' })
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(db.libraryBook.updateMany).not.toHaveBeenCalled();
    });

    it('moves shelf stock by the same delta as total stock', async () => {
      db.libraryBook.findFirst.mockResolvedValue(book as never);
      db.libraryBook.updateMany.mockResolvedValue({ count: 1 } as never);

      await LibraryService.updateBook(SCHOOL, book.id, { totalCopies: 8 });

      expect(db.libraryBook.updateMany).toHaveBeenCalledWith({
        where: { id: book.id, schoolId: SCHOOL },
        data: { totalCopies: { increment: 3 }, availableCopies: { increment: 3 } },
      });
    });

    it('refuses to shrink stock below the copies out on loan', async () => {
      db.libraryBook.findFirst.mockResolvedValue(book as never); // 5 total, 2 on shelf
      db.libraryBook.updateMany.mockResolvedValue({ count: 0 } as never);

      await expect(
        LibraryService.updateBook(SCHOOL, book.id, { totalCopies: 1 })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'COPIES_ON_LOAN' });

      expect(db.libraryBook.updateMany.mock.calls[0][0].where).toEqual({
        id: book.id,
        schoolId: SCHOOL,
        availableCopies: { gte: 4 },
      });
    });
  });

  describe('deleteBook', () => {
    it('blocks removal while copies are still issued', async () => {
      db.libraryBook.findFirst.mockResolvedValue(book as never);
      db.bookIssue.count.mockResolvedValue(2 as never);

      await expect(LibraryService.deleteBook(SCHOOL, book.id)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'COPIES_ON_LOAN',
      });
      expect(db.libraryBook.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes with a tenant-scoped filter', async () => {
      db.libraryBook.findFirst.mockResolvedValue(book as never);
      db.bookIssue.count.mockResolvedValue(0 as never);

      await LibraryService.deleteBook(SCHOOL, book.id);

      expect(db.libraryBook.deleteMany).toHaveBeenCalledWith({
        where: { id: book.id, schoolId: SCHOOL },
      });
    });
  });

  describe('listIssues', () => {
    const query = { page: 1, pageSize: 20 };

    beforeEach(() => {
      db.bookIssue.findMany.mockResolvedValue([] as never);
      db.bookIssue.count.mockResolvedValue(0 as never);
    });

    it('shows staff the whole school register', async () => {
      await LibraryService.listIssues(SCHOOL, { userId: 'u1', role: UserRole.TEACHER }, query);
      expect(db.bookIssue.findMany.mock.calls[0][0]!.where).toEqual({ schoolId: SCHOOL });
    });

    it('limits a student to their own loans', async () => {
      await LibraryService.listIssues(SCHOOL, { userId: 'u1', role: UserRole.STUDENT }, query);
      expect(db.bookIssue.findMany.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        student: { userId: 'u1' },
      });
    });

    it("limits a parent to their children's loans", async () => {
      await LibraryService.listIssues(SCHOOL, { userId: 'u1', role: UserRole.PARENT }, query);
      expect(db.bookIssue.findMany.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        student: { parent: { userId: 'u1' } },
      });
    });

    it('derives OVERDUE status and a running fine for late open loans', async () => {
      db.bookIssue.findMany.mockResolvedValue([
        issueRow({ dueDate: new Date(NOW.getTime() - 2 * DAY_MS) }),
      ] as never);
      db.bookIssue.count.mockResolvedValue(1 as never);

      const { items } = await LibraryService.listIssues(
        SCHOOL,
        { userId: 'u1', role: UserRole.SCHOOL_ADMIN },
        { ...query, status: 'OVERDUE' }
      );

      expect(db.bookIssue.findMany.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        returnedAt: null,
        dueDate: { lt: NOW },
      });
      expect(items[0]).toMatchObject({
        status: 'OVERDUE',
        daysOverdue: 2,
        fineAmount: 2 * FINE_PER_DAY,
        student: { name: 'Rahul Sharma', admissionNo: 'ADM-2026-001' },
      });
    });
  });

  describe('issueBook', () => {
    const input = { bookId: book.id, admissionNo: 'adm-2026-001', days: 14 };

    beforeEach(() => {
      db.libraryBook.findFirst.mockResolvedValue(book as never);
      db.student.findFirst.mockResolvedValue(student as never);
      db.bookIssue.findMany.mockResolvedValue([] as never);
      db.libraryBook.updateMany.mockResolvedValue({ count: 1 } as never);
      db.bookIssue.create.mockResolvedValue(issueRow() as never);
    });

    it('claims one copy, records the loan and notifies the student', async () => {
      const result = await LibraryService.issueBook(SCHOOL, 'staff-1', input);

      expect(db.student.findFirst.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        admissionNo: { equals: 'adm-2026-001', mode: 'insensitive' },
      });
      expect(db.libraryBook.updateMany).toHaveBeenCalledWith({
        where: { id: book.id, schoolId: SCHOOL, availableCopies: { gt: 0 } },
        data: { availableCopies: { decrement: 1 } },
      });
      expect(db.bookIssue.create.mock.calls[0][0].data).toMatchObject({
        schoolId: SCHOOL,
        bookId: book.id,
        studentId: student.id,
        issuedById: 'staff-1',
        dueDate: new Date(NOW.getTime() + 14 * DAY_MS),
      });
      expect(db.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-9', link: '/library' }),
      });
      expect(result).toMatchObject({ status: 'ACTIVE', fineAmount: 0 });
    });

    it('returns 404 when the admission number matches no student in this school', async () => {
      db.student.findFirst.mockResolvedValue(null);

      await expect(LibraryService.issueBook(SCHOOL, 'staff-1', input)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('rejects inactive students', async () => {
      db.student.findFirst.mockResolvedValue({ ...student, status: 'INACTIVE' } as never);

      await expect(LibraryService.issueBook(SCHOOL, 'staff-1', input)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'STUDENT_INACTIVE',
      });
    });

    it('rejects a second copy of the same title for one student', async () => {
      db.bookIssue.findMany.mockResolvedValue([{ bookId: book.id }] as never);

      await expect(LibraryService.issueBook(SCHOOL, 'staff-1', input)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'ALREADY_ISSUED',
      });
      expect(db.libraryBook.updateMany).not.toHaveBeenCalled();
    });

    it('enforces the per-student borrowing limit', async () => {
      db.bookIssue.findMany.mockResolvedValue(
        Array.from({ length: MAX_OPEN_ISSUES_PER_STUDENT }, (_, i) => ({ bookId: `other-${i}` })) as never
      );

      await expect(LibraryService.issueBook(SCHOOL, 'staff-1', input)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'BORROW_LIMIT_REACHED',
      });
      expect(db.libraryBook.updateMany).not.toHaveBeenCalled();
    });

    it('fails without creating a loan when the last copy was just taken', async () => {
      db.libraryBook.updateMany.mockResolvedValue({ count: 0 } as never);

      await expect(LibraryService.issueBook(SCHOOL, 'staff-1', input)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'OUT_OF_STOCK',
      });
      expect(db.bookIssue.create).not.toHaveBeenCalled();
      expect(db.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('returnBook', () => {
    it('closes the loan, charges the late fine and restores stock', async () => {
      const dueDate = new Date(NOW.getTime() - 5 * DAY_MS);
      db.bookIssue.findFirst.mockResolvedValue(issueRow({ dueDate }) as never);
      db.bookIssue.updateMany.mockResolvedValue({ count: 1 } as never);
      db.bookIssue.findFirstOrThrow.mockResolvedValue(
        issueRow({ dueDate, returnedAt: NOW, fineAmount: 5 * FINE_PER_DAY }) as never
      );

      const result = await LibraryService.returnBook(SCHOOL, 'issue-1');

      expect(db.bookIssue.updateMany).toHaveBeenCalledWith({
        where: { id: 'issue-1', schoolId: SCHOOL, returnedAt: null },
        data: { returnedAt: NOW, fineAmount: 5 * FINE_PER_DAY },
      });
      expect(db.libraryBook.updateMany).toHaveBeenCalledWith({
        where: { id: book.id, schoolId: SCHOOL },
        data: { availableCopies: { increment: 1 } },
      });
      expect(result).toMatchObject({ status: 'RETURNED', fineAmount: 5 * FINE_PER_DAY });
    });

    it('returns 404 for an issue in another tenant', async () => {
      db.bookIssue.findFirst.mockResolvedValue(null);

      await expect(LibraryService.returnBook(SCHOOL, 'issue-x')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('rejects a book that was already returned', async () => {
      db.bookIssue.findFirst.mockResolvedValue(issueRow({ returnedAt: NOW }) as never);

      await expect(LibraryService.returnBook(SCHOOL, 'issue-1')).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'ALREADY_RETURNED',
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('does not restock twice when a concurrent return wins the race', async () => {
      db.bookIssue.findFirst.mockResolvedValue(issueRow() as never);
      db.bookIssue.updateMany.mockResolvedValue({ count: 0 } as never);

      await expect(LibraryService.returnBook(SCHOOL, 'issue-1')).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'ALREADY_RETURNED',
      });
      expect(db.libraryBook.updateMany).not.toHaveBeenCalled();
    });
  });
});
