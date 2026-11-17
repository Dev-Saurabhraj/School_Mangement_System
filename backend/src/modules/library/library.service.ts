/**
 * @file library.service.ts
 * @description Library catalog and circulation service.
 * Every query is scoped by `schoolId`; stock is moved with guarded atomic updates
 * so two librarians can never issue the same last copy.
 */

import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/apiError.js';
import { PaginationMeta } from '../../utils/apiResponse.js';
import {
  CreateBookInput,
  IssueBookInput,
  ListBooksQuery,
  ListIssuesQuery,
  UpdateBookInput,
} from './library.schema.js';

/** A student may hold at most this many books at once. */
export const MAX_OPEN_ISSUES_PER_STUDENT = 3;
/** Late fine in rupees per day past the due date. */
export const FINE_PER_DAY = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type IssueStatus = 'ACTIVE' | 'OVERDUE' | 'RETURNED';

export interface LibraryViewer {
  userId: string;
  role: UserRole;
}

const issueInclude = {
  book: { select: { id: true, title: true, author: true, isbn: true, category: true } },
  student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } },
} satisfies Prisma.BookIssueInclude;

type IssueWithRelations = Prisma.BookIssueGetPayload<{ include: typeof issueInclude }>;

const buildMeta = (total: number, page: number, pageSize: number): PaginationMeta => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize) || 1,
});

/** Whole days past the due date, counted from the first late moment. */
export const daysOverdue = (dueDate: Date, asOf: Date): number => {
  const lateMs = asOf.getTime() - dueDate.getTime();
  return lateMs > 0 ? Math.ceil(lateMs / DAY_MS) : 0;
};

export const calculateFine = (dueDate: Date, asOf: Date): number =>
  daysOverdue(dueDate, asOf) * FINE_PER_DAY;

const serializeIssue = (issue: IssueWithRelations, now: Date) => {
  const returned = issue.returnedAt !== null;
  const lateDays = daysOverdue(issue.dueDate, issue.returnedAt ?? now);
  const status: IssueStatus = returned ? 'RETURNED' : lateDays > 0 ? 'OVERDUE' : 'ACTIVE';

  return {
    id: issue.id,
    issuedAt: issue.issuedAt,
    dueDate: issue.dueDate,
    returnedAt: issue.returnedAt,
    status,
    daysOverdue: lateDays,
    // Charged fine once returned; the running estimate while the book is still out.
    fineAmount: returned ? Number(issue.fineAmount) : lateDays * FINE_PER_DAY,
    book: issue.book,
    student: {
      id: issue.student.id,
      admissionNo: issue.student.admissionNo,
      name: `${issue.student.firstName} ${issue.student.lastName}`.trim(),
    },
  };
};

export class LibraryService {
  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------

  static async listBooks(schoolId: string, query: ListBooksQuery) {
    const { search, category, availableOnly, page, pageSize } = query;

    const where: Prisma.LibraryBookWhereInput = { schoolId };
    if (category) where.category = category;
    if (availableOnly) where.availableCopies = { gt: 0 };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { author: { contains: search, mode: 'insensitive' } },
        { isbn: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.libraryBook.findMany({
        where,
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.libraryBook.count({ where }),
    ]);

    return { items, meta: buildMeta(total, page, pageSize) };
  }

  /** Headline counters and the category list that drive the library dashboard. */
  static async getSummary(schoolId: string) {
    const now = new Date();

    const [stock, categories, openIssues, overdueIssues] = await Promise.all([
      prisma.libraryBook.aggregate({
        where: { schoolId },
        _count: { _all: true },
        _sum: { totalCopies: true, availableCopies: true },
      }),
      prisma.libraryBook.groupBy({
        by: ['category'],
        where: { schoolId },
        _count: { _all: true },
        orderBy: { category: 'asc' },
      }),
      prisma.bookIssue.count({ where: { schoolId, returnedAt: null } }),
      prisma.bookIssue.count({ where: { schoolId, returnedAt: null, dueDate: { lt: now } } }),
    ]);

    return {
      totalTitles: stock._count._all,
      totalCopies: stock._sum.totalCopies ?? 0,
      availableCopies: stock._sum.availableCopies ?? 0,
      openIssues,
      overdueIssues,
      categories: categories.map((c) => ({ name: c.category, titles: c._count._all })),
      policy: { maxOpenIssuesPerStudent: MAX_OPEN_ISSUES_PER_STUDENT, finePerDay: FINE_PER_DAY },
    };
  }

  static async createBook(schoolId: string, input: CreateBookInput) {
    if (input.isbn) await this.assertIsbnFree(schoolId, input.isbn);

    return prisma.libraryBook.create({
      data: {
        schoolId,
        title: input.title,
        author: input.author,
        isbn: input.isbn || null,
        category: input.category,
        shelfLocation: input.shelfLocation || null,
        totalCopies: input.totalCopies,
        availableCopies: input.totalCopies,
      },
    });
  }

  static async updateBook(schoolId: string, id: string, input: UpdateBookInput) {
    const book = await prisma.libraryBook.findFirst({ where: { id, schoolId } });
    if (!book) throw AppError.notFound('Book not found');

    if (input.isbn && input.isbn !== book.isbn) await this.assertIsbnFree(schoolId, input.isbn);

    const { totalCopies, ...details } = input;
    const delta = totalCopies === undefined ? 0 : totalCopies - book.totalCopies;

    // Shrinking stock is guarded in the WHERE clause, so copies that are out on
    // loan (including ones issued since the read above) can never be written off.
    const { count } = await prisma.libraryBook.updateMany({
      where: { id, schoolId, ...(delta < 0 && { availableCopies: { gte: -delta } }) },
      data: {
        ...details,
        ...(delta !== 0 && {
          totalCopies: { increment: delta },
          availableCopies: { increment: delta },
        }),
      },
    });

    if (count === 0) {
      throw AppError.badRequest(
        'Total copies cannot go below the number currently issued to students',
        'COPIES_ON_LOAN'
      );
    }

    return prisma.libraryBook.findFirst({ where: { id, schoolId } });
  }

  static async deleteBook(schoolId: string, id: string) {
    const book = await prisma.libraryBook.findFirst({ where: { id, schoolId } });
    if (!book) throw AppError.notFound('Book not found');

    const onLoan = await prisma.bookIssue.count({
      where: { schoolId, bookId: id, returnedAt: null },
    });
    if (onLoan > 0) {
      throw AppError.conflict(
        `Cannot remove this title while ${onLoan} cop${onLoan === 1 ? 'y is' : 'ies are'} still issued`,
        'COPIES_ON_LOAN'
      );
    }

    await prisma.libraryBook.deleteMany({ where: { id, schoolId } });
    return { id };
  }

  // ---------------------------------------------------------------------------
  // Circulation
  // ---------------------------------------------------------------------------

  /**
   * Issue register. Staff see the whole school; students see only their own
   * loans and parents only their children's.
   */
  static async listIssues(schoolId: string, viewer: LibraryViewer, query: ListIssuesQuery) {
    const { status, studentId, bookId, page, pageSize } = query;
    const now = new Date();

    const where: Prisma.BookIssueWhereInput = { schoolId };
    if (studentId) where.studentId = studentId;
    if (bookId) where.bookId = bookId;

    if (viewer.role === UserRole.STUDENT) {
      where.student = { userId: viewer.userId };
    } else if (viewer.role === UserRole.PARENT) {
      where.student = { parent: { userId: viewer.userId } };
    }

    if (status === 'RETURNED') where.returnedAt = { not: null };
    if (status === 'OPEN') where.returnedAt = null;
    if (status === 'ACTIVE') Object.assign(where, { returnedAt: null, dueDate: { gte: now } });
    if (status === 'OVERDUE') Object.assign(where, { returnedAt: null, dueDate: { lt: now } });

    const [issues, total] = await Promise.all([
      prisma.bookIssue.findMany({
        where,
        include: issueInclude,
        // Books still out come first, most urgent due date on top.
        orderBy: [{ returnedAt: { sort: 'desc', nulls: 'first' } }, { dueDate: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bookIssue.count({ where }),
    ]);

    return {
      items: issues.map((issue) => serializeIssue(issue, now)),
      meta: buildMeta(total, page, pageSize),
    };
  }

  static async issueBook(schoolId: string, issuedById: string, input: IssueBookInput) {
    const [book, student] = await Promise.all([
      prisma.libraryBook.findFirst({ where: { id: input.bookId, schoolId } }),
      prisma.student.findFirst({
        where: { schoolId, admissionNo: { equals: input.admissionNo, mode: 'insensitive' } },
        select: { id: true, userId: true, status: true },
      }),
    ]);

    if (!book) throw AppError.notFound('Book not found');
    if (!student) {
      throw AppError.notFound(`No student found with admission number "${input.admissionNo}"`);
    }
    if (student.status !== UserStatus.ACTIVE) {
      throw AppError.badRequest('Books can only be issued to active students', 'STUDENT_INACTIVE');
    }

    const now = new Date();
    const dueDate = new Date(now.getTime() + input.days * DAY_MS);

    const issue = await prisma.$transaction(async (tx) => {
      const openIssues = await tx.bookIssue.findMany({
        where: { schoolId, studentId: student.id, returnedAt: null },
        select: { bookId: true },
        take: MAX_OPEN_ISSUES_PER_STUDENT,
      });

      if (openIssues.some((open) => open.bookId === book.id)) {
        throw AppError.conflict('This student already has a copy of this book', 'ALREADY_ISSUED');
      }
      if (openIssues.length >= MAX_OPEN_ISSUES_PER_STUDENT) {
        throw AppError.badRequest(
          `Borrowing limit reached: a student can hold ${MAX_OPEN_ISSUES_PER_STUDENT} books at a time`,
          'BORROW_LIMIT_REACHED'
        );
      }

      // Claim a copy only if one is still on the shelf at write time.
      const claimed = await tx.libraryBook.updateMany({
        where: { id: book.id, schoolId, availableCopies: { gt: 0 } },
        data: { availableCopies: { decrement: 1 } },
      });
      if (claimed.count === 0) {
        throw AppError.conflict('All copies of this book are currently issued', 'OUT_OF_STOCK');
      }

      const created = await tx.bookIssue.create({
        data: { schoolId, bookId: book.id, studentId: student.id, issuedById, issuedAt: now, dueDate },
        include: issueInclude,
      });

      if (student.userId) {
        await tx.notification.create({
          data: {
            userId: student.userId,
            title: 'Library book issued 📚',
            message: `"${book.title}" is due back on ${dueDate.toDateString()}.`,
            type: 'INFO',
            link: '/library',
          },
        });
      }

      return created;
    });

    return serializeIssue(issue, now);
  }

  static async returnBook(schoolId: string, issueId: string) {
    const issue = await prisma.bookIssue.findFirst({ where: { id: issueId, schoolId } });
    if (!issue) throw AppError.notFound('Issue record not found');
    if (issue.returnedAt) {
      throw AppError.conflict('This book has already been returned', 'ALREADY_RETURNED');
    }

    const now = new Date();
    const fineAmount = calculateFine(issue.dueDate, now);

    const updated = await prisma.$transaction(async (tx) => {
      // The returnedAt guard makes a double-click or concurrent return a no-op
      // instead of putting the same copy back on the shelf twice.
      const closed = await tx.bookIssue.updateMany({
        where: { id: issueId, schoolId, returnedAt: null },
        data: { returnedAt: now, fineAmount },
      });
      if (closed.count === 0) {
        throw AppError.conflict('This book has already been returned', 'ALREADY_RETURNED');
      }

      await tx.libraryBook.updateMany({
        where: { id: issue.bookId, schoolId },
        data: { availableCopies: { increment: 1 } },
      });

      return tx.bookIssue.findFirstOrThrow({
        where: { id: issueId, schoolId },
        include: issueInclude,
      });
    });

    return serializeIssue(updated, now);
  }

  private static async assertIsbnFree(schoolId: string, isbn: string) {
    const existing = await prisma.libraryBook.findFirst({
      where: { schoolId, isbn },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict('A book with this ISBN is already in the catalog', 'DUPLICATE_ISBN');
    }
  }
}
