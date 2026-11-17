/**
 * @file MessagesPage.tsx
 * @description Parent-Teacher Messaging orchestrator.
 *  - Parents choose a teacher and chat with them.
 *  - Teachers reply to the parents who wrote to them.
 *  - School admins supervise every conversation read-only and can close / reopen one.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, MessageSquarePlus, MessagesSquare, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { getApiErrorMessage } from '../lib/api';
import { cn } from '../lib/utils';
import {
  useChatConversations,
  useChatSupervisionSummary,
  useMarkConversationRead,
  useSetConversationStatus,
} from '../hooks';
import {
  CloseConversationModal,
  ConversationList,
  MessageThread,
  TeacherPickerModal,
  describeConversation,
} from '../components/features/chat';
import { StatCards, type StatCardItem } from '../components/ui';
import type { ChatConversation, ChatViewerRole, ConversationStatus } from '../types';

const ALL = 'ALL';
type StatusFilter = ConversationStatus | typeof ALL;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: ALL, label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'CLOSED', label: 'Closed' },
];

const viewerRoleOf = (role?: string): ChatViewerRole | null => {
  if (role === 'PARENT') return 'PARENT';
  if (role === 'TEACHER') return 'TEACHER';
  if (role === 'SCHOOL_ADMIN' || role === 'SUPER_ADMIN') return 'SUPERVISOR';
  return null;
};

const pageCopy: Record<ChatViewerRole, { title: string; subtitle: string }> = {
  PARENT: {
    title: 'Messages',
    subtitle: "Talk directly with your child's teachers.",
  },
  TEACHER: {
    title: 'Parent Messages',
    subtitle: 'Conversations with the parents of your students.',
  },
  SUPERVISOR: {
    title: 'Parent-Teacher Conversations',
    subtitle: 'Supervise communication between parents and teachers across the school.',
  },
};

export const MessagesPage: React.FC = () => {
  const { user } = useAuth();
  const { onlineUserIds } = useSocket();
  const viewer = viewerRoleOf(user?.role);
  const isSupervisor = viewer === 'SUPERVISOR';

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL);
  const [selected, setSelected] = useState<ChatConversation | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isWideScreen] = useState(() => window.matchMedia('(min-width: 768px)').matches);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const conversationsQuery = useChatConversations(
    {
      search: search || undefined,
      status: isSupervisor && statusFilter !== ALL ? statusFilter : undefined,
      pageSize: 50,
    },
    viewer !== null
  );
  const summaryQuery = useChatSupervisionSummary(isSupervisor);
  const markRead = useMarkConversationRead();
  const setStatus = useSetConversationStatus();

  const conversations = conversationsQuery.data?.items ?? [];
  // Prefer the live copy from the list; fall back to the selection when a filter hides it.
  // With nothing chosen, wide screens show the most recent thread instead of an empty pane.
  const active = selected
    ? conversations.find((c) => c.id === selected.id) ?? selected
    : isWideScreen
      ? conversations[0] ?? null
      : null;

  // Opening a thread (or receiving a message while it is open) marks it read.
  // Keyed on the latest message so a failed request is not retried in a loop.
  const lastReadAttempt = useRef<string | null>(null);
  const { mutate: markReadMutate } = markRead;
  useEffect(() => {
    if (!active || isSupervisor || active.unreadCount === 0) return;
    const attempt = `${active.id}:${active.lastMessageAt}`;
    if (lastReadAttempt.current === attempt) return;
    lastReadAttempt.current = attempt;
    markReadMutate(active.id);
  }, [active, isSupervisor, markReadMutate]);

  if (!viewer || !user) {
    return (
      <div className="max-w-2xl mx-auto bg-surface rounded-3xl border border-border shadow-card p-12 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-accent-amber-subtle text-accent-amber flex items-center justify-center mb-3">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <p className="text-sm font-bold text-primary">Messaging is not available for this account</p>
        <p className="text-xs text-muted mt-1">
          Parent-teacher messaging is open to parents, teachers and school administrators.
        </p>
      </div>
    );
  }

  const changeStatus = (status: ConversationStatus, reason?: string) => {
    if (!active) return;
    setStatusError(null);
    setStatus.mutate(
      { conversationId: active.id, status, reason },
      {
        onSuccess: (updated) => {
          setSelected(updated);
          setIsCloseModalOpen(false);
        },
        onError: (error) => setStatusError(getApiErrorMessage(error, 'Could not update this conversation.')),
      }
    );
  };

  const summary = summaryQuery.data;
  const supervisionStats: StatCardItem[] = [
    { label: 'Conversations', value: summary?.totalConversations ?? 0, hint: 'Between parents and teachers' },
    {
      label: 'Active This Week',
      value: summary?.activeThisWeek ?? 0,
      hint: `${summary?.messagesThisWeek ?? 0} messages exchanged`,
      tone: 'blue',
    },
    {
      label: 'Awaiting Teacher Reply',
      value: summary?.awaitingTeacherReply ?? 0,
      hint: 'Unread parent messages',
      tone: 'rose',
    },
    { label: 'Closed', value: summary?.closedConversations ?? 0, hint: 'Locked by administration' },
  ];

  const counterpartUserId = active ? describeConversation(active, viewer).counterpartUserId : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">{pageCopy[viewer].title}</h1>
          <p className="text-sm text-secondary">{pageCopy[viewer].subtitle}</p>
        </div>
        {viewer === 'PARENT' && (
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-accent-blue text-white font-bold text-xs shadow-card hover:brightness-110 transition-all duration-200 cursor-pointer active:scale-95 self-start sm:self-auto"
          >
            <MessageSquarePlus className="w-4 h-4" />
            Message a Teacher
          </button>
        )}
      </div>

      {conversationsQuery.isError && (
        <div role="alert" className="p-3.5 rounded-2xl bg-accent-rose-subtle text-accent-rose border border-accent-rose/20 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {getApiErrorMessage(conversationsQuery.error, 'Could not load conversations. Retrying…')}
        </div>
      )}

      {statusError && !isCloseModalOpen && (
        <div role="alert" className="p-3.5 rounded-2xl bg-accent-rose-subtle text-accent-rose border border-accent-rose/20 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {statusError}
        </div>
      )}

      {isSupervisor && (
        <>
          <StatCards stats={supervisionStats} isLoading={summaryQuery.isLoading} />
          <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-200 cursor-pointer active:scale-95',
                  statusFilter === filter.value
                    ? 'bg-accent-blue text-white shadow-sm'
                    : 'bg-surface border border-border text-secondary hover:text-primary'
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[640px]">
        <ConversationList
          conversations={conversations}
          viewer={viewer}
          activeId={active?.id ?? null}
          isLoading={conversationsQuery.isLoading}
          search={searchInput}
          onSearchChange={setSearchInput}
          onSelect={setSelected}
          onNewConversation={viewer === 'PARENT' ? () => setIsPickerOpen(true) : undefined}
          onlineUserIds={onlineUserIds}
          className={cn('h-full', active && 'hidden md:flex')}
        />

        {active ? (
          <MessageThread
            key={active.id}
            conversation={active}
            viewer={viewer}
            currentUserId={user.id}
            isCounterpartOnline={counterpartUserId !== null && onlineUserIds.includes(counterpartUserId)}
            onBack={() => setSelected(null)}
            onRequestClose={() => {
              setStatusError(null);
              setIsCloseModalOpen(true);
            }}
            onReopen={() => changeStatus('OPEN')}
            isUpdatingStatus={setStatus.isPending}
            className="md:col-span-2 h-full"
          />
        ) : (
          <div className="hidden md:flex md:col-span-2 bg-surface rounded-3xl border border-border shadow-card items-center justify-center p-8 text-center">
            <div>
              <div className="w-14 h-14 mx-auto rounded-2xl bg-accent-blue-subtle text-accent-blue flex items-center justify-center mb-3">
                <MessagesSquare className="w-7 h-7" />
              </div>
              <p className="text-sm font-bold text-primary">Select a conversation</p>
              <p className="text-xs text-muted mt-1">
                {viewer === 'PARENT'
                  ? 'Pick a conversation on the left, or message a teacher to start a new one.'
                  : 'Pick a conversation on the left to read it.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {isPickerOpen && (
        <TeacherPickerModal onClose={() => setIsPickerOpen(false)} onConversationReady={setSelected} />
      )}

      {isCloseModalOpen && active && (
        <CloseConversationModal
          conversationTitle={describeConversation(active, 'SUPERVISOR').title}
          isSubmitting={setStatus.isPending}
          error={statusError}
          onCancel={() => setIsCloseModalOpen(false)}
          onConfirm={(reason) => changeStatus('CLOSED', reason || undefined)}
        />
      )}
    </div>
  );
};

export default MessagesPage;
