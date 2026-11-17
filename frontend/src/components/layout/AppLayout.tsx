/**
 * @file AppLayout.tsx
 * @description Main application shell containing the dynamic Sidebar, Top Navbar, and Page Content container.
 */

import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { useAuth } from '../../context/AuthContext';
import { useChatSocketSync } from '../../hooks/useChat';

const CHAT_ROLES = ['PARENT', 'TEACHER', 'SCHOOL_ADMIN'];

export const AppLayout: React.FC = () => {
  const { user } = useAuth();
  // Keeps chat threads, the conversation list and the sidebar badge live on every page.
  useChatSocketSync(Boolean(user && CHAT_ROLES.includes(user.role)));

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Dynamic Left Sidebar (fixed in viewport) */}
      <Sidebar />

      {/* Main Content Area (scrolls independently) */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <Navbar />
        <main className="flex-1 p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
