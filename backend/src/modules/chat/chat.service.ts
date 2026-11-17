/**
 * @file chat.service.ts
 * @description Parent-teacher messaging with school-admin supervision.
 *
 * Access model (enforced here, not only in routes):
 *  - A PARENT sees and posts in threads where they are the parent.
 *  - A TEACHER sees and posts in threads where they are the teacher.
 *  - A SCHOOL_ADMIN can read every thread in the school and lock/unlock it,
 *    but can never post in one.
 * Every query is scoped by `schoolId`.
 */

import { ConversationStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/apiError.js';
import { PaginationMeta } from '../../utils/apiResponse.js';
import {
  ListConversationsQuery,
  ListMessagesQuery,
  ListTeachersQuery,
  SendMessageInput,
  SetConversationStatusInput,
  StartConversationInput,
} from './chat.schema.js';

const PREVIEW_LENGTH = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ChatViewer {
  userId: string;
  role: UserRole;
}

type Actor =
  | { kind: 'PARENT'; parentId: string }
  | { kind: 'TEACHER'; teacherId: string }
  | { kind: 'SUPERVISOR' };

export type ChatSenderRole = 'PARENT' | 'TEACHER';

const conversationInclude = {
  parent: {
    select: {
      id: true,
      relationship: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
      students: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          enrollments: {
            where: { status: 'ACTIVE' },
            orderBy: { enrollmentDate: 'desc' },
            take: 1,
            select: { class: { select: { name: true } }, section: { select: { name: true } } },
          },
        },
      },
    },
  },
  teacher: {
    select: {
      id: true,
      designation: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.ChatConversationInclude;

type ConversationRow = Prisma.ChatConversationGetPayload<{ include: typeof conversationInclude }>;
type MessageRow = Prisma.ChatMessageGetPayload<Record<string, never>>;

const serializeConversation = (row: ConversationRow, actor: Actor) => ({
  id: row.id,
  status: row.status,
  closedReason: row.closedReason,
  createdAt: row.createdAt,
  lastMessageAt: row.lastMessageAt,
  lastMessagePreview: row.lastMessagePreview,
  parentLastReadAt: row.parentLastReadAt,
  teacherLastReadAt: row.teacherLastReadAt,
  unreadCount:
    actor.kind === 'PARENT'
      ? row.parentUnreadCount
      : actor.kind === 'TEACHER'
        ? row.teacherUnreadCount
        : 0,
  canSend: actor.kind !== 'SUPERVISOR' && row.status === ConversationStatus.OPEN,
  parent: {
    id: row.parent.id,
    userId: row.parent.user.id,
    name: row.parent.user.name,
    avatarUrl: row.parent.user.avatarUrl,
    relationship: row.parent.relationship,
    children: row.parent.students.map((student) => {
      const enrollment = student.enrollments[0];
      return {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`.trim(),
        className: enrollment ? `${enrollment.class.name}-${enrollment.section.name}` : null,
      };
    }),
  },
  teacher: {
    id: row.teacher.id,
    userId: row.teacher.user.id,
    name: row.teacher.user.name,
    avatarUrl: row.teacher.user.avatarUrl,
    designation: row.teacher.designation,
  },
});

const serializeMessage = (message: MessageRow, conversation: ConversationRow) => {
  const fromParent = message.senderId === conversation.parent.user.id;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderRole: (fromParent ? 'PARENT' : 'TEACHER') as ChatSenderRole,
    senderName: fromParent ? conversation.parent.user.name : conversation.teacher.user.name,
    body: message.body,
    createdAt: message.createdAt,
  };
};

export type SerializedConversation = ReturnType<typeof serializeConversation>;
export type SerializedMessage = ReturnType<typeof serializeMessage>;

/** User ids of the two people in a thread, used to route real-time events. */
export interface ConversationAudience {
  schoolId: string;
  parentUserId: string;
  teacherUserId: string;
}

const audienceOf = (schoolId: string, row: ConversationRow): ConversationAudience => ({
  schoolId,
  parentUserId: row.parent.user.id,
  teacherUserId: row.teacher.user.id,
});

export class ChatService {
  // ---------------------------------------------------------------------------
  // Identity & access
  // ---------------------------------------------------------------------------

  private static async resolveActor(schoolId: string, viewer: ChatViewer): Promise<Actor> {
    if (viewer.role === UserRole.SCHOOL_ADMIN || viewer.role === UserRole.SUPER_ADMIN) {
      return { kind: 'SUPERVISOR' };
    }

    if (viewer.role === UserRole.PARENT) {
      const parent = await prisma.parent.findFirst({
        where: { userId: viewer.userId, schoolId },
        select: { id: true },
      });
      if (!parent) throw AppError.forbidden('Parent profile not found for this account');
      return { kind: 'PARENT', parentId: parent.id };
    }

    if (viewer.role === UserRole.TEACHER) {
      const teacher = await prisma.teacher.findFirst({
        where: { userId: viewer.userId, schoolId },
        select: { id: true },
      });
      if (!teacher) throw AppError.forbidden('Teacher profile not found for this account');
      return { kind: 'TEACHER', teacherId: teacher.id };
    }

    throw AppError.forbidden('Messaging is available to parents, teachers and school admins');
  }

  /** Tenant filter plus the participant filter for the acting user. */
  private static scope(schoolId: string, actor: Actor): Prisma.ChatConversationWhereInput {
    if (actor.kind === 'PARENT') return { schoolId, parentId: actor.parentId };
    if (actor.kind === 'TEACHER') return { schoolId, teacherId: actor.teacherId };
    return { schoolId };
  }

  /** Loads a thread the actor may see; anything else is reported as not found. */
  private static async loadConversation(schoolId: string, id: string, actor: Actor) {
    const conversation = await prisma.chatConversation.findFirst({
      where: { id, ...this.scope(schoolId, actor) },
      include: conversationInclude,
    });
    if (!conversation) throw AppError.notFound('Conversation not found');
    return conversation;
  }

  // ---------------------------------------------------------------------------
  // Teacher directory (parent picks who to message)
  // ---------------------------------------------------------------------------

  static async listTeachers(schoolId: string, viewer: ChatViewer, query: ListTeachersQuery) {
    const actor = await this.resolveActor(schoolId, viewer);
    if (actor.kind !== 'PARENT') {
      throw AppError.forbidden('Only parents can browse the teacher directory for messaging');
    }

    const [teachers, children] = await Promise.all([
      prisma.teacher.findMany({
        where: {
          schoolId,
          user: {
            status: UserStatus.ACTIVE,
            ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
          },
        },
        select: {
          id: true,
          designation: true,
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { user: { name: 'asc' } },
        take: 100,
      }),
      prisma.student.findMany({
        where: { schoolId, parentId: actor.parentId },
        select: {
          id: true,
          firstName: true,
          enrollments: {
            where: { status: 'ACTIVE' },
            orderBy: { enrollmentDate: 'desc' },
            take: 1,
            select: { classId: true },
          },
        },
        take: 20,
      }),
    ]);

    const teacherIds = teachers.map((t) => t.id);
    const childByClass = new Map<string, string[]>();
    for (const child of children) {
      const classId = child.enrollments[0]?.classId;
      if (classId) childByClass.set(classId, [...(childByClass.get(classId) ?? []), child.firstName]);
    }

    const [classSubjects, conversations] = await Promise.all([
      childByClass.size === 0
        ? []
        : prisma.classSubject.findMany({
            where: { schoolId, classId: { in: [...childByClass.keys()] }, teacherId: { in: teacherIds } },
            select: {
              teacherId: true,
              classId: true,
              subject: { select: { name: true } },
              class: { select: { name: true } },
            },
            take: 500,
          }),
      prisma.chatConversation.findMany({
        where: { schoolId, parentId: actor.parentId, teacherId: { in: teacherIds } },
        select: { id: true, teacherId: true },
      }),
    ]);

    const teachesByTeacher = new Map<string, { childName: string; subject: string; className: string }[]>();
    for (const cs of classSubjects) {
      if (!cs.teacherId) continue;
      const list = teachesByTeacher.get(cs.teacherId) ?? [];
      for (const childName of childByClass.get(cs.classId) ?? []) {
        list.push({ childName, subject: cs.subject.name, className: cs.class.name });
      }
      teachesByTeacher.set(cs.teacherId, list);
    }
    const conversationByTeacher = new Map(conversations.map((c) => [c.teacherId, c.id]));

    return teachers
      .map((teacher) => ({
        id: teacher.id,
        userId: teacher.user.id,
        name: teacher.user.name,
        avatarUrl: teacher.user.avatarUrl,
        designation: teacher.designation,
        teaches: teachesByTeacher.get(teacher.id) ?? [],
        conversationId: conversationByTeacher.get(teacher.id) ?? null,
      }))
      // Teachers of the parent's own children first; the name order is kept within each group.
      .sort((a, b) => Number(b.teaches.length > 0) - Number(a.teaches.length > 0));
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  static async listConversations(schoolId: string, viewer: ChatViewer, query: ListConversationsQuery) {
    const actor = await this.resolveActor(schoolId, viewer);
    const { search, status, page, pageSize } = query;

    const where: Prisma.ChatConversationWhereInput = { ...this.scope(schoolId, actor) };
    if (status) where.status = status;
    // A thread a parent opened but never wrote in is only visible to that parent.
    if (actor.kind !== 'PARENT') where.lastMessageAt = { not: null };
    if (search) {
      const contains = { contains: search, mode: 'insensitive' as const };
      where.OR = [
        { parent: { user: { name: contains } } },
        { teacher: { user: { name: contains } } },
        { parent: { students: { some: { OR: [{ firstName: contains }, { lastName: contains }] } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.chatConversation.findMany({
        where,
        include: conversationInclude,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.chatConversation.count({ where }),
    ]);

    const meta: PaginationMeta = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
    return { items: rows.map((row) => serializeConversation(row, actor)), meta };
  }

  /** Parent opens (or re-opens the existing) thread with a teacher of their school. */
  static async startConversation(schoolId: string, viewer: ChatViewer, input: StartConversationInput) {
    const actor = await this.resolveActor(schoolId, viewer);
    if (actor.kind !== 'PARENT') {
      throw AppError.forbidden('Only parents can start a conversation with a teacher');
    }

    const teacher = await prisma.teacher.findFirst({
      where: { id: input.teacherId, schoolId, user: { status: UserStatus.ACTIVE } },
      select: { id: true },
    });
    if (!teacher) throw AppError.notFound('Teacher not found');

    const conversation = await prisma.chatConversation.upsert({
      where: { parentId_teacherId: { parentId: actor.parentId, teacherId: teacher.id } },
      update: {},
      create: { schoolId, parentId: actor.parentId, teacherId: teacher.id },
      include: conversationInclude,
    });

    return serializeConversation(conversation, actor);
  }

  static async getConversation(schoolId: string, viewer: ChatViewer, id: string) {
    const actor = await this.resolveActor(schoolId, viewer);
    return serializeConversation(await this.loadConversation(schoolId, id, actor), actor);
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /** Newest page first; pass `before` (a message id) to walk back through history. */
  static async listMessages(
    schoolId: string,
    viewer: ChatViewer,
    conversationId: string,
    query: ListMessagesQuery
  ) {
    const actor = await this.resolveActor(schoolId, viewer);
    const conversation = await this.loadConversation(schoolId, conversationId, actor);

    const rows = await prisma.chatMessage.findMany({
      where: { conversationId, schoolId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.before && { cursor: { id: query.before }, skip: 1 }),
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.reverse().map((message) => serializeMessage(message, conversation)),
      nextCursor: hasMore ? page[0].id : null,
    };
  }

  static async sendMessage(
    schoolId: string,
    viewer: ChatViewer,
    conversationId: string,
    input: SendMessageInput
  ) {
    const actor = await this.resolveActor(schoolId, viewer);
    if (actor.kind === 'SUPERVISOR') {
      throw AppError.forbidden(
        'Administrators can review conversations but cannot post in them',
        'SUPERVISOR_READ_ONLY'
      );
    }

    const conversation = await this.loadConversation(schoolId, conversationId, actor);
    if (conversation.status === ConversationStatus.CLOSED) {
      throw AppError.forbidden(
        'This conversation has been closed by the school administration',
        'CONVERSATION_CLOSED'
      );
    }

    const fromParent = actor.kind === 'PARENT';
    const sender = fromParent ? conversation.parent.user : conversation.teacher.user;
    const recipient = fromParent ? conversation.teacher.user : conversation.parent.user;
    const now = new Date();
    const preview =
      input.body.length > PREVIEW_LENGTH ? `${input.body.slice(0, PREVIEW_LENGTH - 1)}…` : input.body;

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: { schoolId, conversationId, senderId: viewer.userId, body: input.body, createdAt: now },
      });

      // Sending implies the sender has read everything so far.
      const updated = await tx.chatConversation.update({
        where: { id: conversationId, schoolId },
        data: {
          lastMessageAt: now,
          lastMessagePreview: preview,
          ...(fromParent
            ? { teacherUnreadCount: { increment: 1 }, parentUnreadCount: 0, parentLastReadAt: now }
            : { parentUnreadCount: { increment: 1 }, teacherUnreadCount: 0, teacherLastReadAt: now }),
        },
        select: { parentUnreadCount: true, teacherUnreadCount: true },
      });

      // One bell notification per unread streak, not one per message.
      const recipientUnread = fromParent ? updated.teacherUnreadCount : updated.parentUnreadCount;
      if (recipientUnread === 1) {
        await tx.notification.create({
          data: {
            userId: recipient.id,
            title: `New message from ${sender.name} 💬`,
            message: preview,
            type: 'INFO',
            link: '/messages',
          },
        });
      }

      return created;
    });

    return {
      message: serializeMessage(message, conversation),
      audience: audienceOf(schoolId, conversation),
    };
  }

  static async markRead(schoolId: string, viewer: ChatViewer, conversationId: string) {
    const actor = await this.resolveActor(schoolId, viewer);
    if (actor.kind === 'SUPERVISOR') {
      // Supervisors leave no trace in read receipts.
      throw AppError.forbidden('Administrators do not have read receipts', 'SUPERVISOR_READ_ONLY');
    }

    const conversation = await this.loadConversation(schoolId, conversationId, actor);
    const readAt = new Date();

    await prisma.chatConversation.update({
      where: { id: conversationId, schoolId },
      data:
        actor.kind === 'PARENT'
          ? { parentUnreadCount: 0, parentLastReadAt: readAt }
          : { teacherUnreadCount: 0, teacherLastReadAt: readAt },
    });

    return {
      receipt: { conversationId, readerRole: actor.kind as ChatSenderRole, readAt },
      audience: audienceOf(schoolId, conversation),
    };
  }

  static async getUnreadCount(schoolId: string, viewer: ChatViewer) {
    const actor = await this.resolveActor(schoolId, viewer);
    if (actor.kind === 'SUPERVISOR') return { unreadCount: 0 };

    const sum = await prisma.chatConversation.aggregate({
      where: this.scope(schoolId, actor),
      _sum: { parentUnreadCount: true, teacherUnreadCount: true },
    });

    return {
      unreadCount:
        (actor.kind === 'PARENT' ? sum._sum.parentUnreadCount : sum._sum.teacherUnreadCount) ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Supervision (school admin)
  // ---------------------------------------------------------------------------

  static async setStatus(
    schoolId: string,
    viewer: ChatViewer,
    conversationId: string,
    input: SetConversationStatusInput
  ) {
    const actor = await this.resolveActor(schoolId, viewer);
    if (actor.kind !== 'SUPERVISOR') {
      throw AppError.forbidden('Only school administrators can close or reopen a conversation');
    }

    await this.loadConversation(schoolId, conversationId, actor);
    const closing = input.status === ConversationStatus.CLOSED;

    const updated = await prisma.chatConversation.update({
      where: { id: conversationId, schoolId },
      data: {
        status: input.status,
        closedById: closing ? viewer.userId : null,
        closedReason: closing ? input.reason || null : null,
      },
      include: conversationInclude,
    });

    return {
      conversation: serializeConversation(updated, actor),
      audience: audienceOf(schoolId, updated),
    };
  }

  static async getSupervisionSummary(schoolId: string, viewer: ChatViewer) {
    const actor = await this.resolveActor(schoolId, viewer);
    if (actor.kind !== 'SUPERVISOR') {
      throw AppError.forbidden('Only school administrators can view messaging oversight');
    }

    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    const started: Prisma.ChatConversationWhereInput = { schoolId, lastMessageAt: { not: null } };

    const [totalConversations, activeThisWeek, closedConversations, awaitingTeacherReply, messagesThisWeek] =
      await Promise.all([
        prisma.chatConversation.count({ where: started }),
        prisma.chatConversation.count({ where: { schoolId, lastMessageAt: { gte: weekAgo } } }),
        prisma.chatConversation.count({ where: { ...started, status: ConversationStatus.CLOSED } }),
        prisma.chatConversation.count({
          where: { schoolId, status: ConversationStatus.OPEN, teacherUnreadCount: { gt: 0 } },
        }),
        prisma.chatMessage.count({ where: { schoolId, createdAt: { gte: weekAgo } } }),
      ]);

    return { totalConversations, activeThisWeek, closedConversations, awaitingTeacherReply, messagesThisWeek };
  }

  // ---------------------------------------------------------------------------
  // Real-time helpers
  // ---------------------------------------------------------------------------

  /**
   * For typing indicators: the other participant's user id, or null when
   * `userId` is not a participant of this thread in this school.
   */
  static async getCounterpartUserId(schoolId: string, conversationId: string, userId: string) {
    const conversation = await prisma.chatConversation.findFirst({
      where: {
        id: conversationId,
        schoolId,
        status: ConversationStatus.OPEN,
        OR: [{ parent: { userId } }, { teacher: { userId } }],
      },
      select: { parent: { select: { userId: true } }, teacher: { select: { userId: true } } },
    });
    if (!conversation) return null;
    return conversation.parent.userId === userId ? conversation.teacher.userId : conversation.parent.userId;
  }
}
