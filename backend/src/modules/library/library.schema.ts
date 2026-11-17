/**
 * @file library.schema.ts
 * @description Zod validation schemas for the Library catalog and book circulation.
 */

import { z } from 'zod';

export const ISSUE_STATUS_FILTERS = ['OPEN', 'ACTIVE', 'OVERDUE', 'RETURNED'] as const;

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

const bookFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  author: z.string().trim().min(1, 'Author is required').max(150),
  isbn: z.string().trim().min(5, 'ISBN looks too short').max(20),
  category: z.string().trim().min(1).max(60),
  shelfLocation: z.string().trim().max(60),
  totalCopies: z.coerce.number().int().min(1, 'At least one copy is required').max(1000),
};

export const listBooksSchema = z.object({
  query: z.object({
    search: z.string().trim().max(100).optional(),
    category: z.string().trim().max(60).optional(),
    availableOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    ...pagination,
  }),
});

export const createBookSchema = z.object({
  body: z.object({
    title: bookFields.title,
    author: bookFields.author,
    isbn: bookFields.isbn.optional(),
    category: bookFields.category.default('General'),
    shelfLocation: bookFields.shelfLocation.optional(),
    totalCopies: bookFields.totalCopies.default(1),
  }),
});

export const updateBookSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      title: bookFields.title,
      author: bookFields.author,
      isbn: bookFields.isbn.nullable(),
      category: bookFields.category,
      shelfLocation: bookFields.shelfLocation.nullable(),
      totalCopies: bookFields.totalCopies,
    })
    .partial()
    .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update'),
});

export const bookIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const listIssuesSchema = z.object({
  query: z.object({
    status: z.enum(ISSUE_STATUS_FILTERS).optional(),
    studentId: z.string().uuid().optional(),
    bookId: z.string().uuid().optional(),
    ...pagination,
  }),
});

export const issueBookSchema = z.object({
  body: z.object({
    bookId: z.string().uuid(),
    admissionNo: z.string().trim().min(1, 'Admission number is required').max(40),
    days: z.coerce.number().int().min(1).max(60).default(14),
  }),
});

export const issueIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export type ListBooksQuery = z.infer<typeof listBooksSchema>['query'];
export type CreateBookInput = z.infer<typeof createBookSchema>['body'];
export type UpdateBookInput = z.infer<typeof updateBookSchema>['body'];
export type ListIssuesQuery = z.infer<typeof listIssuesSchema>['query'];
export type IssueBookInput = z.infer<typeof issueBookSchema>['body'];
