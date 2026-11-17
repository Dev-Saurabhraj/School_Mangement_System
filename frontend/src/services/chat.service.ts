/**
 * @file chat.service.ts
 * @description API service for parent-teacher messaging and admin supervision.
 */

import { api } from '../lib/api';
import type {
  ChatConversation,
  ChatConversationList,
  ChatMessage,
  ChatMessagePage,
  ChatSupervisionSummary,
  ChatTeacherOption,
  ConversationStatus,
  ListConversationsParams,
} from '../types';

const clean = (params: object) =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== '')
  );

export const chatService = {
  /** Parent only: teachers of the school, the child's own teachers first. */
  getTeachers: async (search?: string): Promise<ChatTeacherOption[]> => {
    const res = await api.get('/chat/teachers', { params: clean({ search }) });
    return Array.isArray(res.data?.data) ? res.data.data : [];
  },

  getConversations: async (params: ListConversationsParams = {}): Promise<ChatConversationList> => {
    const res = await api.get('/chat/conversations', { params: clean(params) });
    const items: ChatConversation[] = Array.isArray(res.data?.data) ? res.data.data : [];
    return {
      items,
      meta: res.data?.meta ?? { page: 1, pageSize: items.length, total: items.length, totalPages: 1 },
    };
  },

  /** Parent only: opens the thread with a teacher, or returns the existing one. */
  startConversation: async (teacherId: string): Promise<ChatConversation> => {
    const res = await api.post('/chat/conversations', { teacherId });
    return res.data.data;
  },

  getMessages: async (conversationId: string, before?: string): Promise<ChatMessagePage> => {
    const res = await api.get(`/chat/conversations/${conversationId}/messages`, {
      params: clean({ before }),
    });
    return res.data.data;
  },

  sendMessage: async (conversationId: string, body: string): Promise<ChatMessage> => {
    const res = await api.post(`/chat/conversations/${conversationId}/messages`, { body });
    return res.data.data;
  },

  markRead: async (conversationId: string): Promise<void> => {
    await api.post(`/chat/conversations/${conversationId}/read`);
  },

  getUnreadCount: async (): Promise<number> => {
    const res = await api.get('/chat/unread-count');
    return res.data?.data?.unreadCount ?? 0;
  },

  /** Admin only: lock or unlock a thread. */
  setStatus: async (
    conversationId: string,
    status: ConversationStatus,
    reason?: string
  ): Promise<ChatConversation> => {
    const res = await api.patch(`/chat/conversations/${conversationId}/status`, clean({ status, reason }));
    return res.data.data;
  },

  /** Admin only. */
  getSupervisionSummary: async (): Promise<ChatSupervisionSummary> => {
    const res = await api.get('/chat/supervision/summary');
    return res.data.data;
  },
};
