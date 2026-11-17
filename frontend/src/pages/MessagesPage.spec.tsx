/**
 * @file MessagesPage.spec.tsx
 * @description Component tests for parent-teacher messaging: the parent, teacher and
 * supervising-admin experiences, plus live updates pushed over the socket.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessagesPage } from './MessagesPage';
import { useChatSocketSync } from '../hooks/useChat';

type Handler = (payload: unknown) => void;

const { mockApi, mockUser, mockSocket } = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    mockApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    mockUser: { current: { id: 'user-parent', name: 'Mr. Sharma', role: 'PARENT' } },
    mockSocket: {
      handlers,
      on: (event: string, handler: (payload: unknown) => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
      },
      off: (event: string, handler: (payload: unknown) => void) => handlers.get(event)?.delete(handler),
      emit: vi.fn(),
      /** Simulates an event pushed by the server. */
      receive: (event: string, payload: unknown) => handlers.get(event)?.forEach((h: Handler) => h(payload)),
    },
  };
});

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: mockApi,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

vi.mock('../context/SocketContext', () => ({
  useSocket: () => ({ socket: mockSocket, isConnected: true, onlineUserIds: ['user-teacher'] }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
      const { initial, animate, exit, ...rest } = props as Record<string, unknown>;
      void initial;
      void animate;
      void exit;
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    },
  },
}));

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: 'conv-1',
  status: 'OPEN',
  closedReason: null,
  createdAt: '2026-11-16T09:00:00.000Z',
  lastMessageAt: '2026-11-17T09:05:00.000Z',
  lastMessagePreview: 'He is doing well.',
  parentLastReadAt: null,
  teacherLastReadAt: null,
  unreadCount: 1,
  canSend: true,
  parent: {
    id: 'parent-1',
    userId: 'user-parent',
    name: 'Mr. Sharma',
    avatarUrl: null,
    relationship: 'FATHER',
    children: [{ id: 'student-1', name: 'Rahul Sharma', className: 'Class 10-A' }],
  },
  teacher: {
    id: 'teacher-1',
    userId: 'user-teacher',
    name: 'Amit Sharma',
    avatarUrl: null,
    designation: 'Mathematics Teacher',
  },
  ...overrides,
});

const message = (id: string, senderRole: 'PARENT' | 'TEACHER', body: string) => ({
  id,
  conversationId: 'conv-1',
  senderId: senderRole === 'PARENT' ? 'user-parent' : 'user-teacher',
  senderRole,
  senderName: senderRole === 'PARENT' ? 'Mr. Sharma' : 'Amit Sharma',
  body,
  createdAt: '2026-11-17T09:05:00.000Z',
});

const history = [
  message('m1', 'PARENT', 'How is Rahul coping with Mathematics?'),
  message('m2', 'TEACHER', 'He is doing well.'),
];

const teachers = [
  {
    id: 'teacher-1',
    userId: 'user-teacher',
    name: 'Amit Sharma',
    avatarUrl: null,
    designation: 'Mathematics Teacher',
    teaches: [{ childName: 'Rahul', subject: 'Mathematics', className: 'Class 10' }],
    conversationId: 'conv-1',
  },
  {
    id: 'teacher-2',
    userId: 'user-teacher-2',
    name: 'Priya Patel',
    avatarUrl: null,
    designation: 'Science Teacher',
    teaches: [],
    conversationId: null,
  },
];

const summary = {
  totalConversations: 12,
  activeThisWeek: 7,
  closedConversations: 2,
  awaitingTeacherReply: 3,
  messagesThisWeek: 48,
};

let conversations: ReturnType<typeof conversation>[];

const SocketSync: React.FC = () => {
  useChatSocketSync();
  return null;
};

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SocketSync />
      <MessagesPage />
    </QueryClientProvider>
  );
};

const openConversation = async (name: RegExp) => fireEvent.click(await screen.findByRole('button', { name }));

describe('MessagesPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSocket.handlers.clear();
    mockUser.current = { id: 'user-parent', name: 'Mr. Sharma', role: 'PARENT' };
    conversations = [conversation()];

    mockApi.get.mockImplementation((url: string) => {
      if (url === '/chat/conversations') {
        return Promise.resolve({ data: { data: conversations, meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 } } });
      }
      if (url === '/chat/conversations/conv-1/messages' || url === '/chat/conversations/conv-2/messages') {
        return Promise.resolve({
          data: { data: { items: url.includes('conv-1') ? history : [], nextCursor: null } },
        });
      }
      if (url === '/chat/teachers') return Promise.resolve({ data: { data: teachers } });
      if (url === '/chat/supervision/summary') return Promise.resolve({ data: { data: summary } });
      if (url === '/chat/unread-count') return Promise.resolve({ data: { data: { unreadCount: 1 } } });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    mockApi.post.mockResolvedValue({ data: { data: {} } });
  });

  describe('parent', () => {
    it('opens a conversation, shows the history and marks it read', async () => {
      renderPage();
      await openConversation(/Amit Sharma/);

      expect(await screen.findByText('How is Rahul coping with Mathematics?')).toBeDefined();
      // Preview in the list and the bubble in the thread
      expect(screen.getAllByText('He is doing well.').length).toBe(2);
      expect(screen.getByText(/school administration can review/i)).toBeDefined();
      await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/chat/conversations/conv-1/read'));
    });

    it('sends a message to the teacher and shows it in the thread', async () => {
      mockApi.post.mockImplementation((url: string) =>
        Promise.resolve({
          data: { data: url.endsWith('/messages') ? message('m3', 'PARENT', 'Thank you, sir!') : {} },
        })
      );
      renderPage();
      await openConversation(/Amit Sharma/);

      const input = await screen.findByLabelText('Message Amit Sharma');
      fireEvent.change(input, { target: { value: '  Thank you, sir!  ' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/ }));

      await waitFor(() =>
        expect(mockApi.post).toHaveBeenCalledWith('/chat/conversations/conv-1/messages', {
          body: 'Thank you, sir!',
        })
      );
      expect(await screen.findByText('Thank you, sir!')).toBeDefined();
      await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));
    });

    it('keeps the draft and shows the reason when sending fails', async () => {
      mockApi.post.mockImplementation((url: string) =>
        url.endsWith('/messages')
          ? Promise.reject({
              response: {
                data: { success: false, error: { code: 'CONVERSATION_CLOSED', message: 'This conversation has been closed by the school administration' } },
              },
            })
          : Promise.resolve({ data: { data: {} } })
      );
      renderPage();
      await openConversation(/Amit Sharma/);

      const input = await screen.findByLabelText('Message Amit Sharma');
      fireEvent.change(input, { target: { value: 'Hello?' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect((await screen.findByRole('alert')).textContent).toContain('closed by the school administration');
      expect((input as HTMLTextAreaElement).value).toBe('Hello?');
    });

    it('chooses a teacher from the directory to start a new conversation', async () => {
      const fresh = conversation({
        id: 'conv-2',
        lastMessageAt: null,
        lastMessagePreview: null,
        unreadCount: 0,
        teacher: { id: 'teacher-2', userId: 'user-teacher-2', name: 'Priya Patel', avatarUrl: null, designation: 'Science Teacher' },
      });
      mockApi.post.mockResolvedValue({ data: { data: fresh } });
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Message a Teacher' }));
      const dialog = await screen.findByRole('dialog');

      // The child's own teacher is labelled and the existing thread is offered.
      expect(await within(dialog).findByText("Your child's teacher")).toBeDefined();
      expect(within(dialog).getByText(/Mathematics · Rahul \(Class 10\)/)).toBeDefined();

      fireEvent.click(within(dialog).getByRole('button', { name: /Priya Patel/ }));

      await waitFor(() =>
        expect(mockApi.post).toHaveBeenCalledWith('/chat/conversations', { teacherId: 'teacher-2' })
      );
      expect(await screen.findByLabelText('Message Priya Patel')).toBeDefined();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows a closed conversation as read-only with the reason', async () => {
      conversations = [conversation({ status: 'CLOSED', canSend: false, closedReason: 'Resolved in person', unreadCount: 0 })];
      renderPage();
      await openConversation(/Amit Sharma/);

      expect(await screen.findByText(/Resolved in person/)).toBeDefined();
      expect(screen.queryByLabelText('Message Amit Sharma')).toBeNull();
    });

    it('shows a message pushed by the server without a refresh', async () => {
      renderPage();
      await openConversation(/Amit Sharma/);
      await screen.findByText('How is Rahul coping with Mathematics?');

      act(() => {
        mockSocket.receive('chat:message', {
          conversationId: 'conv-1',
          message: message('m9', 'TEACHER', 'Please check the new worksheet.'),
        });
      });

      expect(await screen.findByText('Please check the new worksheet.')).toBeDefined();
    });
  });

  describe('teacher', () => {
    beforeEach(() => {
      mockUser.current = { id: 'user-teacher', name: 'Amit Sharma', role: 'TEACHER' };
    });

    it('sees which parent and child a conversation is about and can reply', async () => {
      renderPage();
      await openConversation(/Mr\. Sharma/);

      expect((await screen.findAllByText('Parent of Rahul Sharma (Class 10-A)')).length).toBeGreaterThan(0);
      expect(await screen.findByLabelText('Message Mr. Sharma')).toBeDefined();
      // Starting conversations is a parent action.
      expect(screen.queryByRole('button', { name: /Message a Teacher/i })).toBeNull();
    });
  });

  describe('school admin', () => {
    beforeEach(() => {
      mockUser.current = { id: 'user-admin', name: 'Admin', role: 'SCHOOL_ADMIN' };
      conversations = [conversation({ unreadCount: 0, canSend: false })];
    });

    it('supervises read-only with school-wide counters', async () => {
      renderPage();

      expect(await screen.findByText('Awaiting Teacher Reply')).toBeDefined();
      expect(await screen.findByText('48 messages exchanged')).toBeDefined();

      await openConversation(/Mr\. Sharma ↔ Amit Sharma/);

      expect(await screen.findByText('How is Rahul coping with Mathematics?')).toBeDefined();
      expect(screen.getByText(/you can read this conversation but not post in it/i)).toBeDefined();
      expect(screen.getByText('Mr. Sharma · Parent')).toBeDefined();
      expect(screen.queryByRole('textbox', { name: /^Message / })).toBeNull();
      // Supervising leaves no read receipt.
      expect(mockApi.post).not.toHaveBeenCalled();
    });

    it('closes a conversation with a reason', async () => {
      mockApi.patch.mockImplementation(() => {
        // The server now reports the thread as closed in the list as well.
        const closed = conversation({ status: 'CLOSED', canSend: false, closedReason: 'Resolved in person', unreadCount: 0 });
        conversations = [closed];
        return Promise.resolve({ data: { data: closed } });
      });
      renderPage();
      await openConversation(/Mr\. Sharma ↔ Amit Sharma/);

      fireEvent.click(await screen.findByRole('button', { name: /Close Conversation/ }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText(/Reason shown to both participants/), {
        target: { value: 'Resolved in person' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close Conversation' }));

      await waitFor(() =>
        expect(mockApi.patch).toHaveBeenCalledWith('/chat/conversations/conv-1/status', {
          status: 'CLOSED',
          reason: 'Resolved in person',
        })
      );
      expect(await screen.findByRole('button', { name: /Reopen/ })).toBeDefined();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('filters the register by status', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Closed' }));

      await waitFor(() =>
        expect(mockApi.get).toHaveBeenCalledWith('/chat/conversations', {
          params: { status: 'CLOSED', pageSize: 50 },
        })
      );
    });
  });

  it('is not available to students', () => {
    mockUser.current = { id: 'user-student', name: 'Rahul', role: 'STUDENT' };
    renderPage();

    expect(screen.getByText('Messaging is not available for this account')).toBeDefined();
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});
