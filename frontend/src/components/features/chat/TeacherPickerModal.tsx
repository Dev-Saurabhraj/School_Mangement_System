/**
 * @file TeacherPickerModal.tsx
 * @description Parent-facing directory for choosing which teacher to message.
 * The child's own subject teachers are listed first.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronRight, GraduationCap, Search, X } from 'lucide-react';
import { getApiErrorMessage } from '../../../lib/api';
import { useChatTeachers, useStartConversation } from '../../../hooks';
import type { ChatConversation, ChatTeacherOption } from '../../../types';
import { initialOf } from './chatUtils';

interface TeacherPickerModalProps {
  onClose: () => void;
  onConversationReady: (conversation: ChatConversation) => void;
}

const teachesLabel = (teacher: ChatTeacherOption) =>
  teacher.teaches.map((t) => `${t.subject} · ${t.childName} (${t.className})`).join(', ');

export const TeacherPickerModal: React.FC<TeacherPickerModalProps> = ({ onClose, onConversationReady }) => {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const teachersQuery = useChatTeachers(search);
  const startConversation = useStartConversation();
  const teachers = teachersQuery.data ?? [];

  const choose = (teacher: ChatTeacherOption) => {
    setError(null);
    startConversation.mutate(teacher.id, {
      onSuccess: (conversation) => {
        onConversationReady(conversation);
        onClose();
      },
      onError: (err) => setError(getApiErrorMessage(err, 'Could not open this conversation.')),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-picker-title"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-surface rounded-3xl p-6 border border-border shadow-2xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div>
            <h3 id="teacher-picker-title" className="font-bold text-base text-primary flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-accent-blue" />
              Message a Teacher
            </h3>
            <p className="text-xs text-muted mt-0.5">Choose who you would like to write to.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-xl text-muted hover:text-primary hover:bg-surface-raised transition-all duration-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative my-3">
          <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            autoFocus
            aria-label="Search teachers"
            placeholder="Search teachers by name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-3 py-2.5 bg-surface-raised border border-border rounded-xl text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/30 transition-all duration-200"
          />
        </div>

        {error && (
          <p role="alert" className="mb-3 p-2.5 rounded-xl bg-accent-rose-subtle text-accent-rose text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[160px]">
          {teachersQuery.isLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading teachers">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-14 rounded-2xl bg-surface-raised animate-pulse" />
              ))}
            </div>
          ) : teachersQuery.isError ? (
            <p role="alert" className="text-xs text-accent-rose font-semibold text-center py-8">
              Could not load the teacher directory. Please try again.
            </p>
          ) : teachers.length === 0 ? (
            <div className="py-10 text-center">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-accent-blue-subtle text-accent-blue flex items-center justify-center mb-3">
                <GraduationCap className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-primary">No teachers found</p>
              <p className="text-xs text-muted mt-1">
                {search ? 'Try a different name.' : 'Your school has not added any teachers yet.'}
              </p>
            </div>
          ) : (
            teachers.map((teacher) => (
              <button
                key={teacher.id}
                type="button"
                onClick={() => choose(teacher)}
                disabled={startConversation.isPending}
                className="w-full text-left p-3 rounded-2xl flex items-center gap-3 border border-transparent hover:bg-surface-raised hover:border-border transition-all duration-200 active:scale-[0.99] disabled:opacity-60 cursor-pointer"
              >
                <div className="w-10 h-10 rounded-2xl bg-accent-blue text-white flex items-center justify-center font-bold text-sm shrink-0">
                  {initialOf(teacher.name)}
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="font-bold text-primary truncate">{teacher.name}</p>
                  <p className="text-[11px] text-muted truncate">
                    {teacher.teaches.length > 0 ? teachesLabel(teacher) : teacher.designation || 'Teacher'}
                  </p>
                </div>
                {teacher.teaches.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent-green-subtle text-accent-green shrink-0">
                    Your child&apos;s teacher
                  </span>
                )}
                <span className="text-[11px] font-bold text-accent-blue shrink-0 inline-flex items-center">
                  {teacher.conversationId ? 'Open chat' : 'Message'}
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};
