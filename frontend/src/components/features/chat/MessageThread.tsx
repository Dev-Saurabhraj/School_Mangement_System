/**
 * @file MessageThread.tsx
 * @description One chat thread: header, message history with day separators and read
 * receipts, typing indicator and the composer. Admins get a read-only view with
 * close / reopen controls instead of the composer.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCheck, Eye, Lock, LockOpen, Send, ShieldCheck } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { getApiErrorMessage } from '../../../lib/api';
import { useChatMessages, useChatTyping, useSendChatMessage } from '../../../hooks';
import { MAX_CHAT_MESSAGE_LENGTH, type ChatConversation, type ChatViewerRole } from '../../../types';
import { dayKey, describeConversation, formatDayLabel, formatTime, initialOf } from './chatUtils';

interface MessageThreadProps {
  conversation: ChatConversation;
  viewer: ChatViewerRole;
  currentUserId: string;
  isCounterpartOnline: boolean;
  /** Shown on small screens to return to the conversation list. */
  onBack: () => void;
  /** Admin only. */
  onRequestClose?: () => void;
  onReopen?: () => void;
  isUpdatingStatus?: boolean;
  className?: string;
}

export const MessageThread: React.FC<MessageThreadProps> = ({
  conversation,
  viewer,
  currentUserId,
  isCounterpartOnline,
  onBack,
  onRequestClose,
  onReopen,
  isUpdatingStatus,
  className,
}) => {
  const isSupervisor = viewer === 'SUPERVISOR';
  const messagesQuery = useChatMessages(conversation.id);
  const sendMessage = useSendChatMessage();
  const { isOtherTyping, notifyTyping, stopTyping } = useChatTyping(
    conversation.id,
    !isSupervisor && conversation.canSend
  );

  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Pages arrive newest-first; flatten to one oldest-first stream.
  const messages = [...(messagesQuery.data?.pages ?? [])].reverse().flatMap((page) => page.items);
  const lastMessageId = messages[messages.length - 1]?.id;
  const { title, subtitle } = describeConversation(conversation, viewer);

  // Follow new messages, but not history loaded above the fold.
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lastMessageId, isOtherTyping]);

  // "Seen" applies to my latest message once the other side has read past it.
  const counterpartReadAt =
    viewer === 'PARENT' ? conversation.teacherLastReadAt : conversation.parentLastReadAt;
  const lastOwnMessage = [...messages].reverse().find((m) => m.senderId === currentUserId);
  const lastOwnSeen =
    !isSupervisor &&
    lastOwnMessage !== undefined &&
    counterpartReadAt !== null &&
    new Date(counterpartReadAt) >= new Date(lastOwnMessage.createdAt);

  const trimmed = draft.trim();
  const canSubmit = conversation.canSend && trimmed.length > 0 && !sendMessage.isPending;

  const submit = () => {
    if (!canSubmit) return;
    setSendError(null);
    stopTyping();
    sendMessage.mutate(
      { conversationId: conversation.id, body: trimmed },
      {
        onSuccess: () => setDraft(''),
        onError: (error) => setSendError(getApiErrorMessage(error, 'Message could not be sent. Try again.')),
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section
      aria-label={`Conversation: ${title}`}
      className={cn('bg-surface rounded-3xl border border-border shadow-card flex flex-col min-h-0', className)}
    >
      {/* Header */}
      <header className="p-4 border-b border-border flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="md:hidden p-2 rounded-xl text-muted hover:text-primary hover:bg-surface-raised transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-10 h-10 rounded-2xl bg-accent-blue text-white flex items-center justify-center font-bold shrink-0">
          {initialOf(title)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-sm text-primary truncate">{title}</h2>
          <p className="text-xs text-muted truncate flex items-center gap-1.5">
            {isCounterpartOnline && <span className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0" />}
            {subtitle}
            {isCounterpartOnline && ' • Online'}
          </p>
        </div>

        {conversation.status === 'CLOSED' && (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-surface-raised border border-border text-muted inline-flex items-center gap-1 shrink-0">
            <Lock className="w-3 h-3" /> CLOSED
          </span>
        )}

        {isSupervisor &&
          (conversation.status === 'OPEN' ? (
            <button
              type="button"
              onClick={onRequestClose}
              disabled={isUpdatingStatus}
              className="px-3 py-1.5 rounded-xl bg-accent-rose-subtle text-accent-rose text-xs font-bold inline-flex items-center gap-1.5 hover:brightness-95 transition-all duration-200 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Lock className="w-3.5 h-3.5" /> Close Conversation
            </button>
          ) : (
            <button
              type="button"
              onClick={onReopen}
              disabled={isUpdatingStatus}
              className="px-3 py-1.5 rounded-xl bg-accent-green-subtle text-accent-green text-xs font-bold inline-flex items-center gap-1.5 hover:brightness-95 transition-all duration-200 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <LockOpen className="w-3.5 h-3.5" /> Reopen
            </button>
          ))}
      </header>

      {/* Supervision notice */}
      <p className="px-4 py-2 text-[11px] text-muted bg-surface-raised border-b border-border flex items-center gap-1.5">
        {isSupervisor ? (
          <>
            <Eye className="w-3.5 h-3.5 shrink-0" />
            Supervision view — you can read this conversation but not post in it. Participants are not
            notified when you view it.
          </>
        ) : (
          <>
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            For everyone&apos;s safety, school administration can review parent-teacher conversations.
          </>
        )}
      </p>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" role="log" aria-live="polite">
        {messagesQuery.isLoading ? (
          <div className="space-y-3" role="status" aria-label="Loading messages">
            {[60, 40, 70].map((width, i) => (
              <div
                key={i}
                className={cn('h-10 rounded-2xl bg-surface-raised animate-pulse', i % 2 ? 'ml-auto' : '')}
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        ) : messagesQuery.isError ? (
          <p role="alert" className="text-xs text-accent-rose font-semibold text-center py-8">
            Could not load this conversation. It will retry automatically.
          </p>
        ) : (
          <>
            {messagesQuery.hasNextPage && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => messagesQuery.fetchNextPage()}
                  disabled={messagesQuery.isFetchingNextPage}
                  className="px-3 py-1.5 rounded-full bg-surface-raised border border-border text-[11px] font-bold text-secondary hover:text-primary transition-all duration-200 active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {messagesQuery.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
                </button>
              </div>
            )}

            {messages.length === 0 && (
              <p className="text-xs text-muted text-center py-10">
                {conversation.canSend
                  ? `This is the start of your conversation with ${title}. Write a message below.`
                  : 'No messages in this conversation.'}
              </p>
            )}

            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const startsDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
              // Participants see their own messages on the right; admins see the teacher's there.
              const alignRight = isSupervisor
                ? message.senderRole === 'TEACHER'
                : message.senderId === currentUserId;

              return (
                <React.Fragment key={message.id}>
                  {startsDay && (
                    <div className="flex justify-center">
                      <span className="px-3 py-1 rounded-full bg-surface-raised border border-border text-[10px] font-bold text-muted">
                        {formatDayLabel(message.createdAt)}
                      </span>
                    </div>
                  )}
                  <div className={cn('flex', alignRight ? 'justify-end' : 'justify-start')}>
                    <div className="max-w-[80%] sm:max-w-md">
                      {isSupervisor && (
                        <p className={cn('text-[10px] font-bold text-muted mb-0.5', alignRight && 'text-right')}>
                          {message.senderName} · {message.senderRole === 'PARENT' ? 'Parent' : 'Teacher'}
                        </p>
                      )}
                      <div
                        className={cn(
                          'p-3 rounded-2xl text-xs leading-relaxed shadow-sm whitespace-pre-wrap break-words',
                          alignRight
                            ? 'bg-accent-blue text-white rounded-br-none'
                            : 'bg-surface-raised text-primary border border-border rounded-bl-none'
                        )}
                      >
                        {message.body}
                        <span
                          className={cn(
                            'text-[9px] block mt-1 text-right',
                            alignRight ? 'text-white/75' : 'text-muted'
                          )}
                        >
                          {formatTime(message.createdAt)}
                        </span>
                      </div>
                      {lastOwnSeen && message.id === lastOwnMessage?.id && (
                        <p className="text-[10px] text-muted mt-0.5 flex items-center justify-end gap-1">
                          <CheckCheck className="w-3 h-3 text-accent-blue" /> Seen
                        </p>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            {isOtherTyping && (
              <div className="flex items-center gap-2 text-xs text-muted italic px-1" role="status">
                <span className="flex gap-1" aria-hidden>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce [animation-delay:0.4s]" />
                </span>
                {title} is typing…
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer: composer, or the reason there is none */}
      {conversation.status === 'CLOSED' ? (
        <p className="p-4 border-t border-border text-xs text-muted flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            This conversation was closed by the school administration
            {conversation.closedReason ? `: “${conversation.closedReason}”` : '.'}
            {!isSupervisor && ' You can still read it, but new messages are disabled.'}
          </span>
        </p>
      ) : isSupervisor ? null : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="p-3 border-t border-border space-y-2"
        >
          {sendError && (
            <p role="alert" className="px-3 py-2 rounded-xl bg-accent-rose-subtle text-accent-rose text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {sendError}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              aria-label={`Message ${title}`}
              placeholder={`Message ${title}…`}
              rows={1}
              maxLength={MAX_CHAT_MESSAGE_LENGTH}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                notifyTyping();
              }}
              onKeyDown={handleKeyDown}
              className="flex-1 resize-none max-h-32 min-h-[40px] px-4 py-2.5 bg-surface-raised border border-border rounded-xl text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/30 transition-all duration-200"
            />
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2.5 rounded-xl bg-accent-blue text-white font-bold text-xs flex items-center gap-1.5 shadow-card hover:brightness-110 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {sendMessage.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
          <p className="text-[10px] text-muted flex justify-between">
            <span>Enter to send · Shift + Enter for a new line</span>
            {draft.length > MAX_CHAT_MESSAGE_LENGTH * 0.9 && (
              <span>
                {draft.length} / {MAX_CHAT_MESSAGE_LENGTH}
              </span>
            )}
          </p>
        </form>
      )}
    </section>
  );
};
