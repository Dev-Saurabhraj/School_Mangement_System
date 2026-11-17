/**
 * @file chat.schema.ts
 * @description Zod validation schemas for parent-teacher messaging and admin supervision.
 */

import { z } from 'zod';
import { ConversationStatus } from '@prisma/client';

export const MAX_MESSAGE_LENGTH = 2000;

const conversationParams = z.object({ id: z.string().uuid() });

export const listTeachersSchema = z.object({
  query: z.object({
    search: z.string().trim().max(100).optional(),
  }),
});

export const listConversationsSchema = z.object({
  query: z.object({
    search: z.string().trim().max(100).optional(),
    status: z.nativeEnum(ConversationStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
  }),
});

export const startConversationSchema = z.object({
  body: z.object({
    teacherId: z.string().uuid(),
  }),
});

export const conversationIdSchema = z.object({ params: conversationParams });

export const listMessagesSchema = z.object({
  params: conversationParams,
  query: z.object({
    /** Message id cursor: return messages older than this one. */
    before: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }),
});

export const sendMessageSchema = z.object({
  params: conversationParams,
  body: z.object({
    body: z
      .string()
      .trim()
      .min(1, 'Message cannot be empty')
      .max(MAX_MESSAGE_LENGTH, `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`),
  }),
});

export const setConversationStatusSchema = z.object({
  params: conversationParams,
  body: z.object({
    status: z.nativeEnum(ConversationStatus),
    reason: z.string().trim().max(200).optional(),
  }),
});

export type ListTeachersQuery = z.infer<typeof listTeachersSchema>['query'];
export type ListConversationsQuery = z.infer<typeof listConversationsSchema>['query'];
export type StartConversationInput = z.infer<typeof startConversationSchema>['body'];
export type ListMessagesQuery = z.infer<typeof listMessagesSchema>['query'];
export type SendMessageInput = z.infer<typeof sendMessageSchema>['body'];
export type SetConversationStatusInput = z.infer<typeof setConversationStatusSchema>['body'];
