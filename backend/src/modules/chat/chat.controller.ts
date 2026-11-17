/**
 * @file chat.controller.ts
 * @description HTTP handlers for parent-teacher messaging and admin supervision.
 */

import { Request, Response, NextFunction } from 'express';
import { ChatService, ChatViewer } from './chat.service.js';
import { ChatRealtime } from './chat.realtime.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { ListConversationsQuery, ListMessagesQuery, ListTeachersQuery } from './chat.schema.js';

const viewerOf = (req: Request): ChatViewer => ({ userId: req.user!.userId, role: req.user!.role });

export class ChatController {
  static async listTeachers(req: Request, res: Response, next: NextFunction) {
    try {
      const teachers = await ChatService.listTeachers(
        req.schoolId!,
        viewerOf(req),
        req.query as unknown as ListTeachersQuery
      );
      return ApiResponse.success(res, teachers);
    } catch (error) {
      next(error);
    }
  }

  static async listConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const { items, meta } = await ChatService.listConversations(
        req.schoolId!,
        viewerOf(req),
        req.query as unknown as ListConversationsQuery
      );
      return ApiResponse.success(res, items, 'Success', 200, meta);
    } catch (error) {
      next(error);
    }
  }

  static async startConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const conversation = await ChatService.startConversation(req.schoolId!, viewerOf(req), req.body);
      return ApiResponse.success(res, conversation, 'Conversation ready');
    } catch (error) {
      next(error);
    }
  }

  static async getConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const conversation = await ChatService.getConversation(req.schoolId!, viewerOf(req), req.params.id);
      return ApiResponse.success(res, conversation);
    } catch (error) {
      next(error);
    }
  }

  static async listMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const page = await ChatService.listMessages(
        req.schoolId!,
        viewerOf(req),
        req.params.id,
        req.query as unknown as ListMessagesQuery
      );
      return ApiResponse.success(res, page);
    } catch (error) {
      next(error);
    }
  }

  static async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { message, audience } = await ChatService.sendMessage(
        req.schoolId!,
        viewerOf(req),
        req.params.id,
        req.body
      );
      ChatRealtime.messageCreated(audience, message);
      return ApiResponse.created(res, message, 'Message sent');
    } catch (error) {
      next(error);
    }
  }

  static async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { receipt, audience } = await ChatService.markRead(req.schoolId!, viewerOf(req), req.params.id);
      ChatRealtime.conversationRead(audience, receipt);
      return ApiResponse.success(res, receipt, 'Conversation marked as read');
    } catch (error) {
      next(error);
    }
  }

  static async getUnreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ChatService.getUnreadCount(req.schoolId!, viewerOf(req));
      return ApiResponse.success(res, result);
    } catch (error) {
      next(error);
    }
  }

  static async setStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversation, audience } = await ChatService.setStatus(
        req.schoolId!,
        viewerOf(req),
        req.params.id,
        req.body
      );
      ChatRealtime.conversationUpdated(audience, conversation.id, conversation.status);
      return ApiResponse.success(
        res,
        conversation,
        conversation.status === 'CLOSED' ? 'Conversation closed' : 'Conversation reopened'
      );
    } catch (error) {
      next(error);
    }
  }

  static async getSupervisionSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await ChatService.getSupervisionSummary(req.schoolId!, viewerOf(req));
      return ApiResponse.success(res, summary);
    } catch (error) {
      next(error);
    }
  }
}
