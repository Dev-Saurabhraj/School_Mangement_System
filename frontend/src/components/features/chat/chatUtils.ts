/**
 * @file chatUtils.ts
 * @description Formatting and labelling helpers shared by the chat views.
 */

import type { ChatConversation, ChatViewerRole } from '../../../types';

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** "Today", "Yesterday" or a full date — used for separators inside a thread. */
export const formatDayLabel = (iso: string, now = new Date()) => {
  const date = new Date(iso);
  if (sameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Compact timestamp for the conversation list: time today, otherwise the date. */
export const formatListTime = (iso: string | null, now = new Date()) => {
  if (!iso) return '';
  const date = new Date(iso);
  return sameDay(date, now)
    ? formatTime(iso)
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export const dayKey = (iso: string) => new Date(iso).toDateString();

export const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/** "Parent of Rahul Sharma (Class 10-A)" */
export const describeChildren = (conversation: ChatConversation) => {
  const children = conversation.parent.children;
  if (children.length === 0) return 'Parent';
  return `Parent of ${children
    .map((child) => (child.className ? `${child.name} (${child.className})` : child.name))
    .join(', ')}`;
};

/** Title and subtitle of a thread from the viewer's side of the conversation. */
export const describeConversation = (conversation: ChatConversation, viewer: ChatViewerRole) => {
  if (viewer === 'PARENT') {
    return {
      title: conversation.teacher.name,
      subtitle: conversation.teacher.designation || 'Teacher',
      counterpartUserId: conversation.teacher.userId,
    };
  }
  if (viewer === 'TEACHER') {
    return {
      title: conversation.parent.name,
      subtitle: describeChildren(conversation),
      counterpartUserId: conversation.parent.userId,
    };
  }
  return {
    title: `${conversation.parent.name} ↔ ${conversation.teacher.name}`,
    subtitle: describeChildren(conversation),
    counterpartUserId: null,
  };
};
