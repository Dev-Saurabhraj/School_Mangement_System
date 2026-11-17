/**
 * @file socket.server.ts
 * @description Senior-developer real-time Socket.io server with JWT authentication,
 * multi-tenant isolation rooms, direct messaging, and typing indicator events.
 */

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { ChatService } from '../modules/chat/chat.service.js';

/** Private per-user room. Only sockets with a verified JWT are ever joined to it. */
export const userRoom = (userId: string) => `user:${userId}`;
/** School admins supervising parent-teacher chat in one school. */
export const chatSupervisorRoom = (schoolId: string) => `school:${schoolId}:chat-supervisors`;

/** Reads the HttpOnly `accessToken` cookie from the handshake, if the browser sent one. */
const tokenFromCookie = (cookieHeader?: string): string | undefined => {
  const match = cookieHeader?.split(';').find((part) => part.trim().startsWith('accessToken='));
  return match ? decodeURIComponent(match.trim().slice('accessToken='.length)) : undefined;
};

export interface SocketUser {
  userId: string;
  email: string;
  role: string;
  schoolId: string | null;
  name?: string;
}

export interface ClientChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  time: string;
  createdAt: string;
}

// Track active connected users in memory
const activeUserSockets = new Map<string, Set<string>>();

let io: SocketIOServer | null = null;

export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  // 1. Authentication Handshake Middleware
  io.use((socket: Socket, next) => {
    try {
      const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      // The cookie outlives the token kept in localStorage, so try both.
      const candidates = [bearer, tokenFromCookie(socket.handshake.headers?.cookie)];

      socket.data.authenticated = false;
      for (const token of candidates) {
        if (!token) continue;
        try {
          const decoded = verifyAccessToken(token);
          socket.data.user = {
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            schoolId: decoded.schoolId,
          } as SocketUser;
          socket.data.authenticated = true;
          return next();
        } catch {
          // Token expired or invalid — try the next candidate
        }
      }

      // Development / Demo Fallback: Allow authenticated guests with demo identity
      socket.data.user = {
        userId: socket.handshake.auth?.userId || `user-${socket.id.substring(0, 5)}`,
        email: socket.handshake.auth?.email || 'demo@schoolhub.edu',
        role: socket.handshake.auth?.role || 'TEACHER',
        schoolId: socket.handshake.auth?.schoolId || null,
        name: socket.handshake.auth?.name || 'Staff User',
      } as SocketUser;

      next();
    } catch (err: any) {
      next(new Error('Authentication failed'));
    }
  });

  // 2. Connection Handler
  io.on('connection', (socket: Socket) => {
    const user: SocketUser = socket.data.user;

    // Track active connection
    if (!activeUserSockets.has(user.userId)) {
      activeUserSockets.set(user.userId, new Set());
    }
    activeUserSockets.get(user.userId)!.add(socket.id);

    // Private rooms carry personal data (chat messages, read receipts), so only a
    // verified JWT gets in. Demo-fallback identities are client-supplied and are
    // limited to the public demo events below.
    const authenticated: boolean = socket.data.authenticated === true;
    if (authenticated) {
      socket.join(userRoom(user.userId));
      if (user.schoolId) {
        socket.join(`school:${user.schoolId}`);
        if (user.role === 'SCHOOL_ADMIN') {
          socket.join(chatSupervisorRoom(user.schoolId));
        }
      }
    }

    // Broadcast online status to school peers
    socket.broadcast.emit('user_status_change', {
      userId: user.userId,
      status: 'Online',
    });

    console.log(`[Socket.io] User connected: ${user.email} (${socket.id})`);

    // EVENT: Join specific chat conversation room
    socket.on('join_conversation', ({ conversationId }: { conversationId: string }) => {
      socket.join(`chat:${conversationId}`);
      socket.emit('joined_conversation', { conversationId });
    });

    // EVENT: Leave chat conversation room
    socket.on('leave_conversation', ({ conversationId }: { conversationId: string }) => {
      socket.leave(`chat:${conversationId}`);
    });

    // EVENT: Send Real-Time Chat Message
    socket.on(
      'send_message',
      (payload: {
        conversationId: string;
        text: string;
        recipientId?: string;
        senderName?: string;
      }) => {
        if (!payload.text?.trim() || !payload.conversationId) return;

        const message: ClientChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          conversationId: payload.conversationId,
          senderId: user.userId,
          senderName: payload.senderName || user.name || user.email.split('@')[0],
          text: payload.text.trim(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          createdAt: new Date().toISOString(),
        };

        // Broadcast to all participants in conversation room
        io!.to(`chat:${payload.conversationId}`).emit('receive_message', message);

        // Also notify recipient's personal room if provided
        if (payload.recipientId) {
          io!.to(`user:${payload.recipientId}`).emit('new_incoming_message', message);
        }
      }
    );

    // EVENT: Typing Indicators
    socket.on('typing_start', ({ conversationId }: { conversationId: string }) => {
      socket.to(`chat:${conversationId}`).emit('user_typing', {
        conversationId,
        userId: user.userId,
        name: user.name || user.email.split('@')[0],
      });
    });

    socket.on('typing_stop', ({ conversationId }: { conversationId: string }) => {
      socket.to(`chat:${conversationId}`).emit('user_stopped_typing', {
        conversationId,
        userId: user.userId,
      });
    });

    // EVENT: Parent-teacher chat typing indicator. The sender must be a participant
    // of the thread; the lookup is cached per socket so keystrokes stay cheap.
    const typingRecipients = new Map<string, string | null>();
    socket.on(
      'chat:typing',
      async (payload: { conversationId?: string; isTyping?: boolean }) => {
        const conversationId = payload?.conversationId;
        if (!authenticated || !user.schoolId || typeof conversationId !== 'string') return;

        try {
          if (!typingRecipients.has(conversationId)) {
            if (typingRecipients.size >= 50) typingRecipients.clear();
            typingRecipients.set(
              conversationId,
              await ChatService.getCounterpartUserId(user.schoolId, conversationId, user.userId)
            );
          }
          const recipientId = typingRecipients.get(conversationId);
          if (!recipientId) return;

          io!.to(userRoom(recipientId)).emit('chat:typing', {
            conversationId,
            userId: user.userId,
            isTyping: payload.isTyping === true,
          });
        } catch {
          // Typing indicators are best-effort
        }
      }
    );

    // EVENT: Get list of currently online users
    socket.on('get_online_users', () => {
      const onlineUserIds = Array.from(activeUserSockets.keys());
      socket.emit('online_users', onlineUserIds);
    });

    // Disconnect Handler
    socket.on('disconnect', () => {
      const userSockets = activeUserSockets.get(user.userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          activeUserSockets.delete(user.userId);
          socket.broadcast.emit('user_status_change', {
            userId: user.userId,
            status: 'Offline',
          });
        }
      }
      console.log(`[Socket.io] User disconnected: ${user.email} (${socket.id})`);
    });
  });

  return io;
};

export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.io has not been initialized. Call initSocketServer first.');
  }
  return io;
};
