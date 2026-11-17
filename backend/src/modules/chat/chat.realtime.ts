/**
 * @file chat.realtime.ts
 * @description Pushes chat events to the two participants of a thread and to the
 * school's supervising admins. Delivery is best-effort: the REST API is the source
 * of truth, so a missing socket server (tests, cold start) is silently ignored.
 */

import { chatSupervisorRoom, getIO, userRoom } from '../../socket/socket.server.js';
import type { ConversationAudience, SerializedMessage } from './chat.service.js';

const emit = (rooms: string[], event: string, payload: unknown) => {
  try {
    getIO().to(rooms).emit(event, payload);
  } catch {
    // Socket.io not initialised — clients fall back to polling.
  }
};

const everyone = (audience: ConversationAudience) => [
  userRoom(audience.parentUserId),
  userRoom(audience.teacherUserId),
  chatSupervisorRoom(audience.schoolId),
];

export const ChatRealtime = {
  messageCreated(audience: ConversationAudience, message: SerializedMessage) {
    emit(everyone(audience), 'chat:message', { conversationId: message.conversationId, message });
  },

  /** Read receipts go to the two participants only. */
  conversationRead(
    audience: ConversationAudience,
    receipt: { conversationId: string; readerRole: string; readAt: Date }
  ) {
    emit([userRoom(audience.parentUserId), userRoom(audience.teacherUserId)], 'chat:read', receipt);
  },

  conversationUpdated(audience: ConversationAudience, conversationId: string, status: string) {
    emit(everyone(audience), 'chat:conversation', { conversationId, status });
  },
};
