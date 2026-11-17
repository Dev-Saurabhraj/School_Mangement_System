/**
 * @file ConversationList.tsx
 * @description Searchable list of chat threads with previews, unread badges and lock state.
 */

import React from 'react';
import { Lock, MessageSquarePlus, MessagesSquare, Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { ChatConversation, ChatViewerRole } from '../../../types';
import { describeConversation, formatListTime, initialOf } from './chatUtils';

interface ConversationListProps {
  conversations: ChatConversation[];
  viewer: ChatViewerRole;
  activeId: string | null;
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (conversation: ChatConversation) => void;
  /** Parents only: opens the teacher picker. */
  onNewConversation?: () => void;
  onlineUserIds: string[];
  className?: string;
}

const emptyCopy: Record<ChatViewerRole, { title: string; hint: string }> = {
  PARENT: {
    title: 'No conversations yet',
    hint: "Choose one of your child's teachers to send your first message.",
  },
  TEACHER: {
    title: 'No messages from parents yet',
    hint: 'When a parent writes to you, the conversation will appear here.',
  },
  SUPERVISOR: {
    title: 'No conversations to review',
    hint: 'Parent-teacher conversations in your school will appear here.',
  },
};

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  viewer,
  activeId,
  isLoading,
  search,
  onSearchChange,
  onSelect,
  onNewConversation,
  onlineUserIds,
  className,
}) => (
  <div className={cn('bg-surface rounded-3xl p-4 border border-border shadow-card flex flex-col min-h-0', className)}>
    <div className="flex items-center gap-2 mb-3">
      <div className="relative flex-1">
        <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          aria-label="Search conversations"
          placeholder={viewer === 'PARENT' ? 'Search teachers...' : 'Search parent, teacher or student...'}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-3 py-2 bg-surface-raised border border-border rounded-xl text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/30 transition-all duration-200"
        />
      </div>
      {onNewConversation && (
        <button
          type="button"
          onClick={onNewConversation}
          aria-label="New message"
          title="Message a teacher"
          className="p-2.5 rounded-xl bg-accent-blue text-white shadow-card hover:brightness-110 transition-all duration-200 active:scale-95 cursor-pointer shrink-0"
        >
          <MessageSquarePlus className="w-4 h-4" />
        </button>
      )}
    </div>

    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading conversations">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-surface-raised animate-pulse" />
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <div className="py-12 px-4 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-accent-blue-subtle text-accent-blue flex items-center justify-center mb-3">
            <MessagesSquare className="w-7 h-7" />
          </div>
          <p className="text-sm font-bold text-primary">
            {search ? 'No conversations match your search' : emptyCopy[viewer].title}
          </p>
          <p className="text-xs text-muted mt-1">
            {search ? 'Try a different name.' : emptyCopy[viewer].hint}
          </p>
          {!search && onNewConversation && (
            <button
              type="button"
              onClick={onNewConversation}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-accent-blue text-white font-bold text-xs shadow-card hover:brightness-110 transition-all duration-200 active:scale-95 cursor-pointer"
            >
              <MessageSquarePlus className="w-4 h-4" />
              Message a Teacher
            </button>
          )}
        </div>
      ) : (
        conversations.map((conversation) => {
          const { title, subtitle, counterpartUserId } = describeConversation(conversation, viewer);
          const isActive = conversation.id === activeId;
          const isOnline = counterpartUserId !== null && onlineUserIds.includes(counterpartUserId);
          const hasUnread = conversation.unreadCount > 0;

          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation)}
              aria-current={isActive}
              className={cn(
                'w-full text-left p-3 rounded-2xl flex items-center gap-3 border transition-all duration-200 cursor-pointer',
                isActive
                  ? 'bg-accent-blue-subtle border-accent-blue/30'
                  : 'border-transparent hover:bg-surface-raised'
              )}
            >
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-2xl bg-accent-blue text-white flex items-center justify-center font-bold text-sm shadow-sm">
                  {initialOf(title)}
                </div>
                {isOnline && (
                  <span
                    title="Online"
                    className="w-2.5 h-2.5 rounded-full absolute -bottom-0.5 -right-0.5 border-2 border-surface bg-accent-green"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className={cn('truncate text-primary', hasUnread ? 'font-extrabold' : 'font-bold')}>
                    {title}
                  </p>
                  <span className="text-[10px] text-muted shrink-0">
                    {formatListTime(conversation.lastMessageAt)}
                  </span>
                </div>
                <p className="text-[10px] text-muted truncate">{subtitle}</p>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className={cn('text-[11px] truncate', hasUnread ? 'text-primary font-semibold' : 'text-muted')}>
                    {conversation.lastMessagePreview ?? 'No messages yet — say hello'}
                  </p>
                  {conversation.status === 'CLOSED' ? (
                    <Lock className="w-3 h-3 text-muted shrink-0" aria-label="Closed" />
                  ) : hasUnread ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent-blue text-white leading-none shrink-0">
                      {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  </div>
);
