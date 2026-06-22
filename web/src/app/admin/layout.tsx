import React from 'react';
import './admin-globals.css';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-root min-h-screen bg-[#F7F7F7] text-[#111827]">
      {children}
    </div>
  );
}
