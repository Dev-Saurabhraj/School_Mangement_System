/**
 * @file chat.types.ts
 * @description Domain types for parent-teacher messaging and admin supervision.
 */

export type ConversationStatus = 'OPEN' | 'CLOSED';
export type ChatSenderRole = 'PARENT' | 'TEACHER';
/** How the signed-in user relates to the chat. */
export type ChatViewerRole = ChatSenderRole | 'SUPERVISOR';

export interface ChatParticipantParent {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  relationship: string;
  children: { id: string; name: string; className: string | null }[];
}

export interface ChatParticipantTeacher {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  designation: string | null;
}

export interface ChatConversation {
  id: string;
  status: ConversationStatus;
  closedReason: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  parentLastReadAt: string | null;
  teacherLastReadAt: string | null;
  /** Unread messages for the signed-in user (always 0 for supervising admins). */
  unreadCount: number;
  /** False for admins and for closed conversations. */
  canSend: boolean;
  parent: ChatParticipantParent;
  teacher: ChatParticipantTeacher;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: ChatSenderRole;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface ChatMessagePage {
  /** Oldest first. */
  items: ChatMessage[];
  /** Pass as `before` to load the previous page; null when history is exhausted. */
  nextCursor: string | null;
}

export interface ChatTeacherOption {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  designation: string | null;
  /** Subjects this teacher takes for the parent's own children. */
  teaches: { childName: string; subject: string; className: string }[];
  /** Existing thread with this teacher, if any. */
  conversationId: string | null;
}

export interface ChatConversationList {
  items: ChatConversation[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ListConversationsParams {
  search?: string;
  status?: ConversationStatus;
  page?: number;
  pageSize?: number;
}

export interface ChatSupervisionSummary {
  totalConversations: number;
  activeThisWeek: number;
  closedConversations: number;
  awaitingTeacherReply: number;
  messagesThisWeek: number;
}

export const MAX_CHAT_MESSAGE_LENGTH = 2000;
