/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Experts from "./pages/Experts";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import Tenders from "./pages/Tenders";
import MatchEngine from "./pages/MatchEngine";
import MatchResults from "./pages/MatchResults";
import GeneratedCVs from "./pages/GeneratedCVs";
import Settings from "./pages/Settings";
import TenderDetails from "./pages/TenderDetails";
import { Search, Menu } from "lucide-react";

import { TasksProvider } from "./lib/TasksContext";
import { AuthProvider, useAuth } from "./lib/auth";
import TasksOverlay from "./components/TasksOverlay";
import NotificationPanel from "./components/NotificationPanel";
import { GlobalModals } from "./components/GlobalModals";
import { useState, useEffect } from "react";

function AppShell() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    // Optionally keep loadSettings placeholder if it's doing nothing,
    // actually let's just leave the standard layout and ignore settings reload since nothing else uses it
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
        Loading VIA CV Generation...
      </div>
    );
  }

  if (location.pathname === "/") {
    return (
      <Routes>
        <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Landing />} />
      </Routes>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans selection:bg-blue-600 selection:text-white">
      <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />

      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 relative technical-grid">
        {/* Top Header */}
        <header className="h-16 border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 bg-white/80 backdrop-blur-md z-10 w-full">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="md:hidden text-slate-600 hover:text-slate-900 p-2 -ml-2"
          >
            <Menu size={24} />
          </button>
          <div className="flex-1" />
          <NotificationPanel />
        </header>

        {/* Viewport */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 w-full max-w-[100vw]">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/experts" element={<Experts />} />
            <Route path="/tenders" element={<Tenders />} />
            <Route path="/tenders/:tenderId" element={<MatchEngine />} />
            <Route
              path="/tenders/:tenderId/details"
              element={<TenderDetails />}
            />
            <Route path="/matches" element={<MatchResults />} />
            <Route path="/generated-cvs" element={<GeneratedCVs />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>

        <TasksOverlay />
        <GlobalModals />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <TasksProvider>
      <AuthProvider>
        <Router>
          <AppShell />
        </Router>
      </AuthProvider>
    </TasksProvider>
  );
}
