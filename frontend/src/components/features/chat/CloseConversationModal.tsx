/**
 * @file CloseConversationModal.tsx
 * @description Admin confirmation for locking a parent-teacher conversation.
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Lock, X } from 'lucide-react';

interface CloseConversationModalProps {
  conversationTitle: string;
  isSubmitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export const CloseConversationModal: React.FC<CloseConversationModalProps> = ({
  conversationTitle,
  isSubmitting,
  error,
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-conversation-title"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-surface rounded-3xl p-6 border border-border shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h3 id="close-conversation-title" className="font-bold text-base text-primary flex items-center gap-2">
            <Lock className="w-5 h-5 text-accent-rose" />
            Close Conversation
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="p-2 rounded-xl text-muted hover:text-primary hover:bg-surface-raised transition-all duration-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-secondary leading-relaxed">
          <span className="font-bold text-primary">{conversationTitle}</span> will no longer be able to
          exchange messages. Both can still read the history, and you can reopen it at any time.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(reason.trim());
          }}
          className="space-y-3 text-xs"
        >
          <div>
            <label htmlFor="close-reason" className="font-bold text-secondary block mb-1">
              Reason shown to both participants (optional)
            </label>
            <input
              id="close-reason"
              type="text"
              autoFocus
              maxLength={200}
              placeholder="e.g. Resolved in the parent-teacher meeting"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-raised border border-border text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/30 transition-all duration-200"
            />
          </div>

          {error && (
            <p role="alert" className="p-2.5 rounded-xl bg-accent-rose-subtle text-accent-rose font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl bg-surface-raised text-secondary font-bold border border-border hover:text-primary transition-all duration-200 active:scale-95 cursor-pointer"
            >
              Keep Open
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-accent-rose text-white font-bold hover:brightness-110 transition-all duration-200 active:scale-95 disabled:opacity-60 cursor-pointer"
            >
              {isSubmitting ? 'Closing…' : 'Close Conversation'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
