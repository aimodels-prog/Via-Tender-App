import { useState, useEffect, useRef } from 'react';
import { Bell, X, Info } from 'lucide-react';
import { api } from '../lib/api';
import clsx from 'clsx';

export default function NotificationPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [hasNew, setHasNew] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Basic polling or just initial fetch to check for new logs
    const checkLogs = async () => {
      const data = await api.getLogs();
      const lastCheck = localStorage.getItem('lastNotificationCheck');
      if (data.length > 0) {
        if (!lastCheck || new Date(data[0].timestamp).getTime() > parseInt(lastCheck)) {
          setHasNew(true);
        }
      }
    };
    checkLogs();
    
    // Simulate real-time updates for the "demo"
    const handleActivity = () => checkLogs();
    window.addEventListener('activityLogged', handleActivity);
    return () => window.removeEventListener('activityLogged', handleActivity);
  }, []);

  useEffect(() => {
    const fetchLogs = async () => {
      const data = await api.getLogs();
      setLogs(data.slice(0, 50));
      if (isOpen) {
        setHasNew(false);
        localStorage.setItem('lastNotificationCheck', Date.now().toString());
      }
    };
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={panelRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="text-slate-600 hover:text-slate-900 transition-colors shrink-0 relative p-1"
      >
        <Bell size={20} />
        {hasNew && (
          <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 border-2 border-slate-50 rounded-full animate-pulse z-10" />
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-200/50 z-50 overflow-hidden flex flex-col max-h-[400px]">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <h3 className="font-semibold text-slate-800 text-sm">Activity Logs</h3>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <div className="overflow-y-auto w-full custom-scrollbar flex-1 p-2">
            {logs.length > 0 ? (
              <div className="flex flex-col gap-1">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 bg-white hover:bg-slate-50 border border-transparent hover:border-slate-100 rounded-lg transition-colors flex gap-3 items-start">
                    <div className="shrink-0 mt-0.5 text-blue-500">
                      <Info size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 truncate">{log.action}</p>
                      <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{log.detail}</p>
                      {log.timestamp && (
                        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-medium">
                          {new Date(log.timestamp).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500 text-sm">
                No recent activity.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
