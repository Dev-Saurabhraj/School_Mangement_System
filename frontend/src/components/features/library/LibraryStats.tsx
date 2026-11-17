/**
 * @file LibraryStats.tsx
 * @description Headline counter cards for the library page.
 */

import React from 'react';
import { cn } from '../../../lib/utils';

export interface LibraryStat {
  label: string;
  value: number | string;
  hint: string;
  tone?: 'default' | 'green' | 'blue' | 'rose';
}

const toneClass: Record<NonNullable<LibraryStat['tone']>, string> = {
  default: 'text-primary',
  green: 'text-accent-green',
  blue: 'text-accent-blue',
  rose: 'text-accent-rose',
};

interface LibraryStatsProps {
  stats: LibraryStat[];
  isLoading?: boolean;
}

export const LibraryStats: React.FC<LibraryStatsProps> = ({ stats, isLoading }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {stats.map((stat) => (
      <div
        key={stat.label}
        className="bg-surface rounded-2xl p-4 border border-border shadow-card transition-all duration-200 hover:scale-[1.02]"
      >
        <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{stat.label}</span>
        {isLoading ? (
          <div className="h-8 w-16 mt-1 rounded-lg bg-surface-raised animate-pulse" aria-hidden />
        ) : (
          <p className={cn('text-2xl font-extrabold mt-1', toneClass[stat.tone ?? 'default'])}>
            {stat.value}
          </p>
        )}
        <span className="text-[11px] text-muted">{stat.hint}</span>
      </div>
    ))}
  </div>
);
