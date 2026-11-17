/**
 * @file chat.routes.ts
 * @description Express routes for parent-teacher messaging and admin supervision.
 */

import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { ChatController } from './chat.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireTenant } from '../../middleware/tenant.middleware.js';
import { requireRoles } from '../../middleware/rbac.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  conversationIdSchema,
  listConversationsSchema,
  listMessagesSchema,
  listTeachersSchema,
  sendMessageSchema,
  setConversationStatusSchema,
  startConversationSchema,
} from './chat.schema.js';

const router = Router();

const supervisors = requireRoles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN);
const participants = requireRoles(UserRole.PARENT, UserRole.TEACHER);

// Students have no access to parent-teacher messaging.
router.use(
  authenticate,
  requireTenant,
  requireRoles(UserRole.PARENT, UserRole.TEACHER, UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
);

// Parent: choose a teacher and open a thread
router.get(
  '/teachers',
  requireRoles(UserRole.PARENT),
  validate(listTeachersSchema),
  ChatController.listTeachers
);
router.post(
  '/conversations',
  requireRoles(UserRole.PARENT),
  validate(startConversationSchema),
  ChatController.startConversation
);

// Participants and supervising admins (scoped to the viewer inside the service)
router.get('/conversations', validate(listConversationsSchema), ChatController.listConversations);
router.get('/conversations/:id', validate(conversationIdSchema), ChatController.getConversation);
router.get('/conversations/:id/messages', validate(listMessagesSchema), ChatController.listMessages);
router.get('/unread-count', ChatController.getUnreadCount);

// Participants only — admins supervise read-only
router.post(
  '/conversations/:id/messages',
  participants,
  validate(sendMessageSchema),
  ChatController.sendMessage
);
router.post(
  '/conversations/:id/read',
  participants,
  validate(conversationIdSchema),
  ChatController.markRead
);

// Supervision
router.get('/supervision/summary', supervisors, ChatController.getSupervisionSummary);
router.patch(
  '/conversations/:id/status',
  supervisors,
  validate(setConversationStatusSchema),
  ChatController.setStatus
);

export const chatRoutes = router;
