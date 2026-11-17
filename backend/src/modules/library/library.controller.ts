/**
 * @file library.controller.ts
 * @description HTTP handlers for the Library catalog and book circulation.
 */

import { Request, Response, NextFunction } from 'express';
import { LibraryService } from './library.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { ListBooksQuery, ListIssuesQuery } from './library.schema.js';

export class LibraryController {
  static async listBooks(req: Request, res: Response, next: NextFunction) {
    try {
      const { items, meta } = await LibraryService.listBooks(
        req.schoolId!,
        req.query as unknown as ListBooksQuery
      );
      return ApiResponse.success(res, items, 'Success', 200, meta);
    } catch (error) {
      next(error);
    }
  }

  static async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await LibraryService.getSummary(req.schoolId!);
      return ApiResponse.success(res, summary);
    } catch (error) {
      next(error);
    }
  }

  static async createBook(req: Request, res: Response, next: NextFunction) {
    try {
      const book = await LibraryService.createBook(req.schoolId!, req.body);
      return ApiResponse.created(res, book, 'Book added to the catalog');
    } catch (error) {
      next(error);
    }
  }

  static async updateBook(req: Request, res: Response, next: NextFunction) {
    try {
      const book = await LibraryService.updateBook(req.schoolId!, req.params.id, req.body);
      return ApiResponse.success(res, book, 'Book updated');
    } catch (error) {
      next(error);
    }
  }

  static async deleteBook(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await LibraryService.deleteBook(req.schoolId!, req.params.id);
      return ApiResponse.success(res, result, 'Book removed from the catalog');
    } catch (error) {
      next(error);
    }
  }

  static async listIssues(req: Request, res: Response, next: NextFunction) {
    try {
      const { items, meta } = await LibraryService.listIssues(
        req.schoolId!,
        { userId: req.user!.userId, role: req.user!.role },
        req.query as unknown as ListIssuesQuery
      );
      return ApiResponse.success(res, items, 'Success', 200, meta);
    } catch (error) {
      next(error);
    }
  }

  static async issueBook(req: Request, res: Response, next: NextFunction) {
    try {
      const issue = await LibraryService.issueBook(req.schoolId!, req.user!.userId, req.body);
      return ApiResponse.created(res, issue, 'Book issued successfully');
    } catch (error) {
      next(error);
    }
  }

  static async returnBook(req: Request, res: Response, next: NextFunction) {
    try {
      const issue = await LibraryService.returnBook(req.schoolId!, req.params.id);
      return ApiResponse.success(res, issue, 'Book returned and stock restored');
    } catch (error) {
      next(error);
    }
  }
}
