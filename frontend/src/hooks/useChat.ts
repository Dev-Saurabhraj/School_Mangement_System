/**
 * @file useChat.ts
 * @description TanStack Query hooks for parent-teacher messaging, plus the Socket.io
 * bridge that keeps the cache live. The REST API is the source of truth: sockets only
 * make updates instant, and every query also polls so chat works without them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { chatService } from '../services';
import { useSocket } from '../context/SocketContext';
import type {
  ChatMessage,
  ChatMessagePage,
  ConversationStatus,
  ListConversationsParams,
} from '../types';

export const CHAT_KEYS = {
  all: ['chat'] as const,
  conversationLists: () => [...CHAT_KEYS.all, 'conversations'] as const,
  conversations: (params: ListConversationsParams) => [...CHAT_KEYS.conversationLists(), params] as const,
  messages: (conversationId: string) => [...CHAT_KEYS.all, 'messages', conversationId] as const,
  teachers: (search: string) => [...CHAT_KEYS.all, 'teachers', search] as const,
  unread: () => [...CHAT_KEYS.all, 'unread'] as const,
  summary: () => [...CHAT_KEYS.all, 'summary'] as const,
};

/** Adds a message to the newest cached page of its thread (no-op if already there). */
const appendMessage = (queryClient: QueryClient, message: ChatMessage) => {
  queryClient.setQueryData<InfiniteData<ChatMessagePage>>(
    CHAT_KEYS.messages(message.conversationId),
    (data) => {
      if (!data || data.pages.some((page) => page.items.some((m) => m.id === message.id))) return data;
      const [newest, ...older] = data.pages;
      return { ...data, pages: [{ ...newest, items: [...newest.items, message] }, ...older] };
    }
  );
};

/** List-level state (previews, unread counts, counters) derived from messages. */
const refreshOverview = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: CHAT_KEYS.conversationLists() });
  queryClient.invalidateQueries({ queryKey: CHAT_KEYS.unread() });
  queryClient.invalidateQueries({ queryKey: CHAT_KEYS.summary() });
};

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

export const useChatConversations = (params: ListConversationsParams, enabled = true) =>
  useQuery({
    queryKey: CHAT_KEYS.conversations(params),
    queryFn: () => chatService.getConversations(params),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

/** Pages are newest-first; each page's items are oldest-first. */
export const useChatMessages = (conversationId: string | null) =>
  useInfiniteQuery({
    queryKey: CHAT_KEYS.messages(conversationId ?? 'none'),
    queryFn: ({ pageParam }) => chatService.getMessages(conversationId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(conversationId),
    refetchInterval: 15_000,
  });

export const useChatTeachers = (search: string, enabled = true) =>
  useQuery({
    queryKey: CHAT_KEYS.teachers(search),
    queryFn: () => chatService.getTeachers(search || undefined),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useChatUnreadCount = (enabled = true) =>
  useQuery({
    queryKey: CHAT_KEYS.unread(),
    queryFn: chatService.getUnreadCount,
    enabled,
    refetchInterval: 60_000,
  });

export const useChatSupervisionSummary = (enabled = true) =>
  useQuery({
    queryKey: CHAT_KEYS.summary(),
    queryFn: chatService.getSupervisionSummary,
    enabled,
    refetchInterval: 60_000,
  });

// -----------------------------------------------------------------------------
// Mutations
// -----------------------------------------------------------------------------

export const useStartConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (teacherId: string) => chatService.startConversation(teacherId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_KEYS.all }),
  });
};

export const useSendChatMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, body }: { conversationId: string; body: string }) =>
      chatService.sendMessage(conversationId, body),
    onSuccess: (message) => {
      appendMessage(queryClient, message);
      refreshOverview(queryClient);
    },
  });
};

export const useMarkConversationRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => chatService.markRead(conversationId),
    onSuccess: () => refreshOverview(queryClient),
  });
};

export const useSetConversationStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; status: ConversationStatus; reason?: string }) =>
      chatService.setStatus(input.conversationId, input.status, input.reason),
    onSuccess: () => refreshOverview(queryClient),
  });
};

// -----------------------------------------------------------------------------
// Real-time
// -----------------------------------------------------------------------------

/**
 * Mount once for the signed-in app shell: applies server-pushed chat events to the
 * query cache so open threads, the conversation list and the unread badge stay live.
 */
export const useChatSocketSync = (enabled = true) => {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket || !enabled) return;

    const onMessage = ({ message }: { message: ChatMessage }) => {
      appendMessage(queryClient, message);
      refreshOverview(queryClient);
    };
    const onOverviewChange = () => refreshOverview(queryClient);

    socket.on('chat:message', onMessage);
    socket.on('chat:read', onOverviewChange);
    socket.on('chat:conversation', onOverviewChange);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:read', onOverviewChange);
      socket.off('chat:conversation', onOverviewChange);
    };
  }, [socket, queryClient, enabled]);
};

const TYPING_EMIT_INTERVAL_MS = 2000;
const TYPING_IDLE_MS = 2500;
const TYPING_DISPLAY_MS = 4000;

/**
 * Typing indicator for one thread: who is typing to me, and telling them when I am.
 * Mount it per thread (the thread view is keyed by conversation id).
 */
export const useChatTyping = (conversationId: string | null, enabled = true) => {
  const { socket } = useSocket();
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const lastEmitRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!socket || !conversationId || !enabled) return;

    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const onTyping = (event: { conversationId: string; isTyping: boolean }) => {
      if (event.conversationId !== conversationId) return;
      if (hideTimer) clearTimeout(hideTimer);
      setIsOtherTyping(event.isTyping);
      // Self-heal if the "stopped typing" event never arrives.
      if (event.isTyping) hideTimer = setTimeout(() => setIsOtherTyping(false), TYPING_DISPLAY_MS);
    };
    const onMessage = (event: { conversationId: string }) => {
      if (event.conversationId === conversationId) setIsOtherTyping(false);
    };

    socket.on('chat:typing', onTyping);
    socket.on('chat:message', onMessage);
    return () => {
      socket.off('chat:typing', onTyping);
      socket.off('chat:message', onMessage);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [socket, conversationId, enabled]);

  const stopTyping = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
    if (lastEmitRef.current && socket && conversationId) {
      socket.emit('chat:typing', { conversationId, isTyping: false });
    }
    lastEmitRef.current = 0;
  }, [socket, conversationId]);

  const notifyTyping = useCallback(() => {
    if (!socket || !conversationId || !enabled) return;
    const now = Date.now();
    if (now - lastEmitRef.current > TYPING_EMIT_INTERVAL_MS) {
      socket.emit('chat:typing', { conversationId, isTyping: true });
      lastEmitRef.current = now;
    }
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [socket, conversationId, enabled, stopTyping]);

  // Leaving the thread ends any typing indicator we started.
  useEffect(() => stopTyping, [stopTyping]);

  return { isOtherTyping, notifyTyping, stopTyping };
};
