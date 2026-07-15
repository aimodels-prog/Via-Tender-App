import { 
  Home, 
  Briefcase, 
  Users, 
  Target, 
  FileCheck, 
  Settings,
  User,
  LogOut,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import viaLogo from '../assets/via-international-logo.png';

function SidebarItem({ to, icon: Icon, label, onClick, isCollapsed }: { to: string, icon: any, label: string, onClick?: () => void, isCollapsed: boolean }) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      onClick={onClick}
      id={`nav-${label.toLowerCase().replace(' ', '-')}`}
      title={isCollapsed ? label : undefined}
      className={clsx(
        "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors group mb-1",
        isCollapsed ? "justify-center px-0" : "",
        isActive 
          ? "bg-slate-100 text-slate-900 font-medium" 
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      <Icon size={18} className={clsx("shrink-0", isActive ? "text-slate-900" : "text-slate-400 group-hover:text-slate-600")} />
      {!isCollapsed && <span className="text-[13px] whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>}
    </Link>
  );
}

export default function Sidebar({ isOpen, setIsOpen }: { isOpen?: boolean, setIsOpen?: (v: boolean) => void }) {
  const { currentUser, logout } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hiddenModules, setHiddenModules] = useState<string[]>(['matches', 'generated-cvs']);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setHiddenModules(await api.getUserState('hiddenModules', ['matches', 'generated-cvs']));
      } catch (error: any) {
        if (!String(error?.message || '').toLowerCase().includes('authentication')) {
          console.warn('Module preferences could not be loaded:', error);
        }
      }
    };
    
    loadSettings();
    const handleSettingsUpdated = () => {
      loadSettings();
    };
    window.addEventListener('settingsUpdated', handleSettingsUpdated);
    window.addEventListener('authChanged', handleSettingsUpdated);
    return () => {
      window.removeEventListener('settingsUpdated', handleSettingsUpdated);
      window.removeEventListener('authChanged', handleSettingsUpdated);
    };
  }, []);

  const displayProfile = currentUser
    ? {
        fullName: currentUser.name,
        email: currentUser.email,
        avatar: '',
      }
    : { fullName: 'User', email: '', avatar: '' };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 md:hidden transition-opacity"
          onClick={() => setIsOpen?.(false)}
        />
      )}
      
      <aside className={clsx(
        "fixed md:relative inset-y-0 left-0 border-r border-slate-200 flex flex-col flex-shrink-0 z-50 bg-white transition-all duration-300 md:translate-x-0 group",
        isOpen ? "translate-x-0" : "-translate-x-full",
        isCollapsed ? "w-20" : "w-64"
      )}>
        {/* Toggle Button for Desktop */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden md:flex absolute -right-3 top-6 w-6 h-6 bg-white border border-slate-200 rounded-full items-center justify-center text-slate-400 hover:text-slate-600 hover:border-slate-300 z-50 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {isCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>

        <div className={clsx("flex-1 flex flex-col overflow-hidden", isCollapsed ? "p-4" : "p-4 sm:p-6")}>
          <div className={clsx("flex items-center mb-8", isCollapsed ? "justify-center" : "justify-between")}>
            <div className={clsx("flex min-w-0 items-center", isCollapsed ? "justify-center" : "flex-1")}>
              <img
                src={viaLogo}
                alt="VIA International"
                className={clsx("object-contain", isCollapsed ? "h-7 w-11" : "h-12 w-36 object-left")}
              />
            </div>
            {setIsOpen && !isCollapsed && (
              <button 
                onClick={() => setIsOpen(false)}
                className="md:hidden text-slate-400 hover:text-slate-600 p-2"
              >
                <X size={20} />
              </button>
            )}
          </div>

          <nav className="space-y-1 overflow-y-auto custom-scrollbar flex-1 pb-4">
            <SidebarItem isCollapsed={isCollapsed} onClick={() => setIsOpen?.(false)} to="/dashboard" icon={Home} label="Dashboard" />
            {!hiddenModules.includes('experts') && <SidebarItem isCollapsed={isCollapsed} onClick={() => setIsOpen?.(false)} to="/experts" icon={Users} label="Experts" />}
            {!hiddenModules.includes('tenders') && <SidebarItem isCollapsed={isCollapsed} onClick={() => setIsOpen?.(false)} to="/matches" icon={Briefcase} label="Matching" />}
            {!hiddenModules.includes('matches') && <SidebarItem isCollapsed={isCollapsed} onClick={() => setIsOpen?.(false)} to="/tenders" icon={Target} label="Tenders" />}
            {!hiddenModules.includes('generated-cvs') && <SidebarItem isCollapsed={isCollapsed} onClick={() => setIsOpen?.(false)} to="/generated-cvs" icon={FileCheck} label="Generate CV" />}
            <SidebarItem isCollapsed={isCollapsed} onClick={() => setIsOpen?.(false)} to="/settings" icon={Settings} label="Settings" />
          </nav>
        </div>

        <div className={clsx("border-t border-slate-200 bg-white shrink-0 mt-auto flex flex-col", isCollapsed ? "p-4 gap-4 items-center" : "p-4 sm:p-5")}>
          <div className={clsx("flex items-center w-full", isCollapsed ? "justify-center" : "gap-3")}>
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-medium text-slate-600 uppercase overflow-hidden shrink-0">
              {displayProfile.fullName.substring(0, 2) || 'U'}
            </div>
            {!isCollapsed && (
              <div className="overflow-hidden flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{displayProfile.fullName}</p>
                <p className="text-xs text-slate-500 truncate">{displayProfile.email}</p>
              </div>
            )}
          </div>
          
          <div className={clsx("flex items-center text-slate-500", isCollapsed ? "flex-col gap-3 mt-0" : "gap-2 mt-4")}>
             <Link 
               to="/settings?tab=profile" 
               onClick={() => setIsOpen?.(false)}
               className={clsx("hover:text-slate-900 transition-colors flex items-center justify-center gap-2", isCollapsed ? "w-full p-2" : "flex-1 hover:bg-slate-50 px-2 py-1.5 rounded-md border border-slate-200 bg-white")}
               title="Profile Settings"
             >
               <User size={16} />
               {!isCollapsed && <span className="text-xs font-medium">Profile</span>}
             </Link>
             <button 
               onClick={logout}
               className={clsx("hover:text-red-700 transition-colors flex items-center justify-center gap-2", isCollapsed ? "w-full p-2 text-red-500 hover:bg-red-50 rounded" : "flex-1 hover:bg-red-50 text-red-600 px-2 py-1.5 rounded-md border border-red-100 bg-white")}
               title="Sign Out"
             >
               <LogOut size={16} />
               {!isCollapsed && <span className="text-xs font-medium">Sign Out</span>}
             </button>
          </div>
        </div>
      </aside>
    </>
  );
}
