/**
 * @file chat.service.spec.ts
 * @description Unit tests for parent-teacher messaging: participant isolation,
 * read-only supervision, unread tracking and conversation locking (Prisma mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    parent: { findFirst: vi.fn() },
    teacher: { findFirst: vi.fn(), findMany: vi.fn() },
    student: { findMany: vi.fn() },
    classSubject: { findMany: vi.fn() },
    chatConversation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    chatMessage: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

import { prisma } from '../../db/prisma.js';
import { ChatService } from './chat.service.js';

const db = vi.mocked(prisma, true);

const SCHOOL = 'school-1';
const NOW = new Date('2026-11-17T10:00:00.000Z');

const parentViewer = { userId: 'user-parent', role: UserRole.PARENT };
const teacherViewer = { userId: 'user-teacher', role: UserRole.TEACHER };
const adminViewer = { userId: 'user-admin', role: UserRole.SCHOOL_ADMIN };
const studentViewer = { userId: 'user-student', role: UserRole.STUDENT };

const conversationRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'conv-1',
  schoolId: SCHOOL,
  parentId: 'parent-1',
  teacherId: 'teacher-1',
  status: 'OPEN',
  closedById: null,
  closedReason: null,
  lastMessageAt: NOW,
  lastMessagePreview: 'Hello',
  parentUnreadCount: 2,
  teacherUnreadCount: 5,
  parentLastReadAt: null,
  teacherLastReadAt: null,
  createdAt: NOW,
  parent: {
    id: 'parent-1',
    relationship: 'FATHER',
    user: { id: 'user-parent', name: 'Mr. Sharma', avatarUrl: null },
    students: [
      {
        id: 'student-1',
        firstName: 'Rahul',
        lastName: 'Sharma',
        enrollments: [{ class: { name: 'Class 10' }, section: { name: 'A' } }],
      },
    ],
  },
  teacher: {
    id: 'teacher-1',
    designation: 'Mathematics Teacher',
    user: { id: 'user-teacher', name: 'Amit Sharma', avatarUrl: null },
  },
  ...overrides,
});

const messageRow = (id: string, senderId: string, body = 'Hello') => ({
  id,
  schoolId: SCHOOL,
  conversationId: 'conv-1',
  senderId,
  body,
  createdAt: NOW,
});

describe('ChatService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db.$transaction.mockImplementation(((run: (tx: typeof prisma) => unknown) => run(prisma)) as never);
    db.parent.findFirst.mockResolvedValue({ id: 'parent-1' } as never);
    db.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('access', () => {
    it('rejects students outright', async () => {
      await expect(
        ChatService.listConversations(SCHOOL, studentViewer, { page: 1, pageSize: 30 })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(db.chatConversation.findMany).not.toHaveBeenCalled();
    });

    it('rejects a parent account with no parent profile in this school', async () => {
      db.parent.findFirst.mockResolvedValue(null);

      await expect(
        ChatService.listConversations(SCHOOL, parentViewer, { page: 1, pageSize: 30 })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(db.parent.findFirst.mock.calls[0][0]!.where).toEqual({
        userId: 'user-parent',
        schoolId: SCHOOL,
      });
    });
  });

  describe('listConversations', () => {
    beforeEach(() => {
      db.chatConversation.findMany.mockResolvedValue([conversationRow()] as never);
      db.chatConversation.count.mockResolvedValue(1 as never);
    });

    it('shows a parent only their own threads with their own unread count', async () => {
      const { items } = await ChatService.listConversations(SCHOOL, parentViewer, {
        page: 1,
        pageSize: 30,
      });

      expect(db.chatConversation.findMany.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        parentId: 'parent-1',
      });
      expect(items[0]).toMatchObject({
        unreadCount: 2,
        canSend: true,
        teacher: { name: 'Amit Sharma' },
        parent: { children: [{ name: 'Rahul Sharma', className: 'Class 10-A' }] },
      });
    });

    it('shows a teacher only their own threads and hides never-used ones', async () => {
      const { items } = await ChatService.listConversations(SCHOOL, teacherViewer, {
        page: 1,
        pageSize: 30,
      });

      expect(db.chatConversation.findMany.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        teacherId: 'teacher-1',
        lastMessageAt: { not: null },
      });
      expect(items[0].unreadCount).toBe(5);
    });

    it('lets an admin see the whole school, read-only and without unread state', async () => {
      const { items } = await ChatService.listConversations(SCHOOL, adminViewer, {
        page: 1,
        pageSize: 30,
        status: 'CLOSED',
      });

      expect(db.chatConversation.findMany.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        status: 'CLOSED',
        lastMessageAt: { not: null },
      });
      expect(items[0]).toMatchObject({ unreadCount: 0, canSend: false });
    });
  });

  describe('listTeachers', () => {
    it('lists school teachers with the child-specific subjects first', async () => {
      db.teacher.findMany.mockResolvedValue([
        { id: 'teacher-2', designation: 'Art', user: { id: 'u2', name: 'Anita Rao', avatarUrl: null } },
        { id: 'teacher-1', designation: 'Maths', user: { id: 'u1', name: 'Amit Sharma', avatarUrl: null } },
      ] as never);
      db.student.findMany.mockResolvedValue([
        { id: 'student-1', firstName: 'Rahul', enrollments: [{ classId: 'class-10' }] },
      ] as never);
      db.classSubject.findMany.mockResolvedValue([
        {
          teacherId: 'teacher-1',
          classId: 'class-10',
          subject: { name: 'Mathematics' },
          class: { name: 'Class 10' },
        },
      ] as never);
      db.chatConversation.findMany.mockResolvedValue([{ id: 'conv-1', teacherId: 'teacher-1' }] as never);

      const teachers = await ChatService.listTeachers(SCHOOL, parentViewer, {});

      expect(db.teacher.findMany.mock.calls[0][0]!.where).toMatchObject({ schoolId: SCHOOL });
      expect(db.student.findMany.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        parentId: 'parent-1',
      });
      expect(teachers.map((t) => t.id)).toEqual(['teacher-1', 'teacher-2']);
      expect(teachers[0]).toMatchObject({
        conversationId: 'conv-1',
        teaches: [{ childName: 'Rahul', subject: 'Mathematics', className: 'Class 10' }],
      });
      expect(teachers[1]).toMatchObject({ conversationId: null, teaches: [] });
    });

    it('is not available to teachers', async () => {
      await expect(ChatService.listTeachers(SCHOOL, teacherViewer, {})).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  describe('startConversation', () => {
    it('opens one thread per parent-teacher pair within the tenant', async () => {
      db.chatConversation.upsert.mockResolvedValue(conversationRow() as never);

      await ChatService.startConversation(SCHOOL, parentViewer, { teacherId: 'teacher-1' });

      expect(db.teacher.findFirst.mock.calls[0][0]!.where).toMatchObject({
        id: 'teacher-1',
        schoolId: SCHOOL,
      });
      expect(db.chatConversation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { parentId_teacherId: { parentId: 'parent-1', teacherId: 'teacher-1' } },
          create: { schoolId: SCHOOL, parentId: 'parent-1', teacherId: 'teacher-1' },
          update: {},
        })
      );
    });

    it('returns 404 for a teacher from another school', async () => {
      db.teacher.findFirst.mockResolvedValue(null);

      await expect(
        ChatService.startConversation(SCHOOL, parentViewer, { teacherId: 'teacher-x' })
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(db.chatConversation.upsert).not.toHaveBeenCalled();
    });

    it('cannot be used by a teacher', async () => {
      await expect(
        ChatService.startConversation(SCHOOL, teacherViewer, { teacherId: 'teacher-1' })
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('listMessages', () => {
    it("hides another parent's thread as not found", async () => {
      db.chatConversation.findFirst.mockResolvedValue(null);

      await expect(
        ChatService.listMessages(SCHOOL, parentViewer, 'conv-other', { limit: 30 })
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(db.chatConversation.findFirst.mock.calls[0][0]!.where).toEqual({
        id: 'conv-other',
        schoolId: SCHOOL,
        parentId: 'parent-1',
      });
      expect(db.chatMessage.findMany).not.toHaveBeenCalled();
    });

    it('returns the newest page oldest-first with a cursor for older history', async () => {
      db.chatConversation.findFirst.mockResolvedValue(conversationRow() as never);
      // Newest first from the database; one extra row signals more history.
      db.chatMessage.findMany.mockResolvedValue([
        messageRow('m3', 'user-teacher'),
        messageRow('m2', 'user-parent'),
        messageRow('m1', 'user-parent'),
      ] as never);

      const page = await ChatService.listMessages(SCHOOL, adminViewer, 'conv-1', { limit: 2 });

      expect(db.chatMessage.findMany.mock.calls[0][0]).toMatchObject({
        where: { conversationId: 'conv-1', schoolId: SCHOOL },
        take: 3,
      });
      expect(page.items.map((m) => m.id)).toEqual(['m2', 'm3']);
      expect(page.nextCursor).toBe('m2');
      expect(page.items[0]).toMatchObject({ senderRole: 'PARENT', senderName: 'Mr. Sharma' });
      expect(page.items[1]).toMatchObject({ senderRole: 'TEACHER', senderName: 'Amit Sharma' });
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      db.chatConversation.findFirst.mockResolvedValue(conversationRow() as never);
      db.chatMessage.create.mockResolvedValue(messageRow('m1', 'user-parent', 'Is Rahul doing well?') as never);
      db.chatConversation.update.mockResolvedValue({ parentUnreadCount: 0, teacherUnreadCount: 1 } as never);
    });

    it('stores the message, bumps the teacher unread count and notifies once', async () => {
      const { message, audience } = await ChatService.sendMessage(SCHOOL, parentViewer, 'conv-1', {
        body: 'Is Rahul doing well?',
      });

      expect(db.chatMessage.create.mock.calls[0][0].data).toMatchObject({
        schoolId: SCHOOL,
        conversationId: 'conv-1',
        senderId: 'user-parent',
        body: 'Is Rahul doing well?',
      });
      expect(db.chatConversation.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'conv-1', schoolId: SCHOOL },
        data: {
          lastMessagePreview: 'Is Rahul doing well?',
          teacherUnreadCount: { increment: 1 },
          parentUnreadCount: 0,
          parentLastReadAt: NOW,
        },
      });
      expect(db.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-teacher', link: '/messages' }),
      });
      expect(message).toMatchObject({ senderRole: 'PARENT', body: 'Is Rahul doing well?' });
      expect(audience).toEqual({
        schoolId: SCHOOL,
        parentUserId: 'user-parent',
        teacherUserId: 'user-teacher',
      });
    });

    it('does not stack bell notifications while earlier messages are still unread', async () => {
      db.chatConversation.update.mockResolvedValue({ parentUnreadCount: 0, teacherUnreadCount: 4 } as never);

      await ChatService.sendMessage(SCHOOL, parentViewer, 'conv-1', { body: 'One more thing' });

      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it("bumps the parent's unread count when the teacher replies", async () => {
      db.chatMessage.create.mockResolvedValue(messageRow('m2', 'user-teacher') as never);
      db.chatConversation.update.mockResolvedValue({ parentUnreadCount: 1, teacherUnreadCount: 0 } as never);

      await ChatService.sendMessage(SCHOOL, teacherViewer, 'conv-1', { body: 'He is doing great.' });

      expect(db.chatConversation.update.mock.calls[0][0].data).toMatchObject({
        parentUnreadCount: { increment: 1 },
        teacherUnreadCount: 0,
      });
      expect(db.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-parent' }),
      });
    });

    it('never lets a supervising admin post', async () => {
      await expect(
        ChatService.sendMessage(SCHOOL, adminViewer, 'conv-1', { body: 'Hi' })
      ).rejects.toMatchObject({ statusCode: 403, errorCode: 'SUPERVISOR_READ_ONLY' });
      expect(db.chatMessage.create).not.toHaveBeenCalled();
    });

    it('blocks new messages in a closed conversation', async () => {
      db.chatConversation.findFirst.mockResolvedValue(conversationRow({ status: 'CLOSED' }) as never);

      await expect(
        ChatService.sendMessage(SCHOOL, parentViewer, 'conv-1', { body: 'Hello?' })
      ).rejects.toMatchObject({ statusCode: 403, errorCode: 'CONVERSATION_CLOSED' });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("cannot post into a thread the sender is not part of", async () => {
      db.chatConversation.findFirst.mockResolvedValue(null);

      await expect(
        ChatService.sendMessage(SCHOOL, teacherViewer, 'conv-other', { body: 'Hi' })
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(db.chatConversation.findFirst.mock.calls[0][0]!.where).toEqual({
        id: 'conv-other',
        schoolId: SCHOOL,
        teacherId: 'teacher-1',
      });
    });
  });

  describe('markRead', () => {
    it("clears only the reader's unread counter", async () => {
      db.chatConversation.findFirst.mockResolvedValue(conversationRow() as never);

      const { receipt } = await ChatService.markRead(SCHOOL, teacherViewer, 'conv-1');

      expect(db.chatConversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1', schoolId: SCHOOL },
        data: { teacherUnreadCount: 0, teacherLastReadAt: NOW },
      });
      expect(receipt).toEqual({ conversationId: 'conv-1', readerRole: 'TEACHER', readAt: NOW });
    });

    it('leaves no read receipt for a supervising admin', async () => {
      await expect(ChatService.markRead(SCHOOL, adminViewer, 'conv-1')).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(db.chatConversation.update).not.toHaveBeenCalled();
    });
  });

  describe('getUnreadCount', () => {
    it("sums the viewer's side across their threads", async () => {
      db.chatConversation.aggregate.mockResolvedValue({
        _sum: { parentUnreadCount: 3, teacherUnreadCount: 9 },
      } as never);

      expect(await ChatService.getUnreadCount(SCHOOL, parentViewer)).toEqual({ unreadCount: 3 });
      expect(db.chatConversation.aggregate.mock.calls[0][0]!.where).toEqual({
        schoolId: SCHOOL,
        parentId: 'parent-1',
      });
    });

    it('is always zero for admins', async () => {
      expect(await ChatService.getUnreadCount(SCHOOL, adminViewer)).toEqual({ unreadCount: 0 });
      expect(db.chatConversation.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('setStatus', () => {
    it('lets an admin close a thread with a reason', async () => {
      db.chatConversation.findFirst.mockResolvedValue(conversationRow() as never);
      db.chatConversation.update.mockResolvedValue(
        conversationRow({ status: 'CLOSED', closedReason: 'Resolved in person' }) as never
      );

      const { conversation } = await ChatService.setStatus(SCHOOL, adminViewer, 'conv-1', {
        status: 'CLOSED',
        reason: 'Resolved in person',
      });

      expect(db.chatConversation.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'conv-1', schoolId: SCHOOL },
        data: { status: 'CLOSED', closedById: 'user-admin', closedReason: 'Resolved in person' },
      });
      expect(conversation).toMatchObject({ status: 'CLOSED', canSend: false });
    });

    it('clears the closing details when reopening', async () => {
      db.chatConversation.findFirst.mockResolvedValue(conversationRow({ status: 'CLOSED' }) as never);
      db.chatConversation.update.mockResolvedValue(conversationRow() as never);

      await ChatService.setStatus(SCHOOL, adminViewer, 'conv-1', { status: 'OPEN' });

      expect(db.chatConversation.update.mock.calls[0][0].data).toEqual({
        status: 'OPEN',
        closedById: null,
        closedReason: null,
      });
    });

    it('cannot be used by a participant', async () => {
      await expect(
        ChatService.setStatus(SCHOOL, teacherViewer, 'conv-1', { status: 'CLOSED' })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(db.chatConversation.update).not.toHaveBeenCalled();
    });

    it('returns 404 for a thread in another school', async () => {
      db.chatConversation.findFirst.mockResolvedValue(null);

      await expect(
        ChatService.setStatus(SCHOOL, adminViewer, 'conv-x', { status: 'CLOSED' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getSupervisionSummary', () => {
    it('is restricted to admins', async () => {
      await expect(ChatService.getSupervisionSummary(SCHOOL, parentViewer)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('reports school-wide counters', async () => {
      db.chatConversation.count
        .mockResolvedValueOnce(12 as never)
        .mockResolvedValueOnce(7 as never)
        .mockResolvedValueOnce(2 as never)
        .mockResolvedValueOnce(3 as never);
      db.chatMessage.count.mockResolvedValue(48 as never);

      expect(await ChatService.getSupervisionSummary(SCHOOL, adminViewer)).toEqual({
        totalConversations: 12,
        activeThisWeek: 7,
        closedConversations: 2,
        awaitingTeacherReply: 3,
        messagesThisWeek: 48,
      });
    });
  });

  describe('getCounterpartUserId', () => {
    it('returns the other participant for typing indicators', async () => {
      db.chatConversation.findFirst.mockResolvedValue({
        parent: { userId: 'user-parent' },
        teacher: { userId: 'user-teacher' },
      } as never);

      expect(await ChatService.getCounterpartUserId(SCHOOL, 'conv-1', 'user-parent')).toBe('user-teacher');
      expect(db.chatConversation.findFirst.mock.calls[0][0]!.where).toMatchObject({
        id: 'conv-1',
        schoolId: SCHOOL,
        OR: [{ parent: { userId: 'user-parent' } }, { teacher: { userId: 'user-parent' } }],
      });
    });

    it('returns null for someone outside the thread', async () => {
      db.chatConversation.findFirst.mockResolvedValue(null);
      expect(await ChatService.getCounterpartUserId(SCHOOL, 'conv-1', 'intruder')).toBeNull();
    });
  });
});
