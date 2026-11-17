/**
 * @file library.routes.ts
 * @description Express routes for the Library catalog and book circulation.
 */

import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { LibraryController } from './library.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireTenant } from '../../middleware/tenant.middleware.js';
import { requireRoles } from '../../middleware/rbac.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  bookIdParamSchema,
  createBookSchema,
  issueBookSchema,
  issueIdParamSchema,
  listBooksSchema,
  listIssuesSchema,
  updateBookSchema,
} from './library.schema.js';

const router = Router();

router.use(authenticate, requireTenant);

const librarians = requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN);
const admins = requireRoles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN);

// Catalog — readable by every school user
router.get('/books', validate(listBooksSchema), LibraryController.listBooks);
router.get('/summary', LibraryController.getSummary);

// Catalog management
router.post('/books', librarians, validate(createBookSchema), LibraryController.createBook);
router.patch('/books/:id', admins, validate(updateBookSchema), LibraryController.updateBook);
router.delete('/books/:id', admins, validate(bookIdParamSchema), LibraryController.deleteBook);

// Circulation — the register is scoped to the viewer inside the service
router.get('/issues', validate(listIssuesSchema), LibraryController.listIssues);
router.post('/issues', librarians, validate(issueBookSchema), LibraryController.issueBook);
router.post(
  '/issues/:id/return',
  librarians,
  validate(issueIdParamSchema),
  LibraryController.returnBook
);

export const libraryRoutes = router;
