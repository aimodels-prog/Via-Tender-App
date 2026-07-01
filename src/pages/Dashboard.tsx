import { useState, useEffect, useRef } from 'react';
import { 
  Users, 
  FileText, 
  BarChart2, 
  Plus,
  ChevronUp,
  ChevronDown,
  ArrowUpAZ,
  ArrowDownZA
} from 'lucide-react';
import { api } from '../lib/api';
import { Link, useNavigate } from 'react-router-dom';
import DeadlineWarningBanner from '../components/DeadlineWarningBanner';
import { useAuth } from '../lib/auth';

export default function Dashboard() {
  const [stats, setStats] = useState({ totalExperts: 0, activeTenders: 0, cvsGenerated: 0, matchRate: 0 });
  const [tenders, setTenders] = useState<any[]>([]);
  const [matchRates, setMatchRates] = useState<Record<string, string>>({});
  const [userName, setUserName] = useState('Admin User');
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);
  const activeColumnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const s = await api.getStats();
        setStats(s);
        const t = await api.getTenders();
        const latestTenders = t.slice(0, 5);
        
        const allMatches = await api.getMatches();
        const rates: Record<string, string> = {};
        
        latestTenders.forEach((tender: any) => {
          const tenderMatches = allMatches.filter((m: any) => m.tenderId === tender.id);
          const positions = tender.positions || [];
          
          let matchedCount = 0;
          if (positions.length === 0) {
            rates[tender.id] = "-";
            if (tenderMatches.length > 0) {
               matchedCount = new Set(tenderMatches.map((m: any) => m.positionId)).size;
            }
          } else {
            const matchedPositions = new Set(tenderMatches.map((m: any) => m.positionId));
            matchedCount = matchedPositions.size;
            const rate = Math.round((matchedCount / positions.length) * 100);
            rates[tender.id] = `${rate}% ( ${matchedCount}/${positions.length} )`;
          }

          if (tenderMatches.length === 0) {
            tender.status = "Tender Extraction Completed";
          } else if (positions.length > 0 && matchedCount === positions.length) {
            tender.status = "Matching Completed";
          } else {
            tender.status = "Matching Partial";
          }
        });
        
        setTenders(latestTenders);
        setMatchRates(rates);
        
        if (currentUser?.name) setUserName(currentUser.name.split(' ')[0]);
      } catch (err) {
        console.error(err);
      }
    };
    fetchData();

    function handleClickOutside(event: MouseEvent) {
      if (activeColumnMenuRef.current && !activeColumnMenuRef.current.contains(event.target as Node)) {
        setActiveColumnMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [currentUser]);

  const filteredTenders = tenders.filter(t => {
    // Column filters
    for (const [key, value] of Object.entries(columnFilters)) {
      if (!value) continue;
      
      const v = String(value).toLowerCase();
      let tenderVal = "";
      
      if (key === 'internal_code') tenderVal = (t.internal_code || t.id?.slice(0, 8) || '-').toLowerCase();
      else if (key === 'name') tenderVal = (t.tender_title || '-').toLowerCase();
      else if (key === 'description') tenderVal = (t.background || '-').toLowerCase();
      else if (key === 'client') tenderVal = (t.client || '-').toLowerCase();
      
      if (!tenderVal.includes(v)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    const mod = direction === 'asc' ? 1 : -1;
    
    let aVal: any = "";
    let bVal: any = "";
    
    if (key === 'internal_code') {
      aVal = a.internal_code || a.id?.slice(0, 8) || '';
      bVal = b.internal_code || b.id?.slice(0, 8) || '';
    } else if (key === 'name') {
      aVal = a.tender_title || '';
      bVal = b.tender_title || '';
    } else if (key === 'description') {
      aVal = a.background || '';
      bVal = b.background || '';
    } else if (key === 'client') {
      aVal = a.client || '';
      bVal = b.client || '';
    }
    
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    
    if (aVal < bVal) return -1 * mod;
    if (aVal > bVal) return 1 * mod;
    return 0;
  });

  const renderColumnHeader = (id: string, label: string) => (
    <th key={id} className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap relative">
      <div 
        className="flex items-center gap-1 cursor-pointer hover:text-slate-700 select-none"
        onClick={(e) => {
          e.stopPropagation();
          setActiveColumnMenu(activeColumnMenu === id ? null : id);
        }}
      >
        {label} 
        {sortConfig?.key === id ? (
          sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-blue-600" /> : <ChevronDown size={12} className="text-blue-600" />
        ) : (
          <ChevronDown size={12} className="opacity-50" />
        )}
      </div>

      {activeColumnMenu === id && (
        <div 
          ref={activeColumnMenuRef}
          className="absolute left-6 top-10 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-30 font-normal normal-case tracking-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-1">
            <div className="px-3 py-2 text-xs font-semibold text-slate-500">Sort</div>
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-sm font-medium text-slate-700 rounded-md transition-colors"
              onClick={() => {
                setSortConfig({ key: id, direction: 'asc' });
                setActiveColumnMenu(null);
              }}
            >
              <ArrowUpAZ size={14} className="text-slate-400" />
              <span>Sort Ascending</span>
            </button>
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-sm font-medium text-slate-700 rounded-md transition-colors"
              onClick={() => {
                setSortConfig({ key: id, direction: 'desc' });
                setActiveColumnMenu(null);
              }}
            >
              <ArrowDownZA size={14} className="text-slate-400" />
              <span>Sort Descending</span>
            </button>
          </div>
          <div className="h-px bg-slate-100 my-1"></div>
          <div className="p-1 border-t border-slate-100">
            <div className="px-3 py-2 text-xs font-semibold text-slate-500">Filter</div>
            <div className="px-2 pb-2">
              <input 
                type="text" 
                placeholder={`Filter ${label}...`}
                value={columnFilters[id] || ''}
                onChange={(e) => setColumnFilters(prev => ({ ...prev, [id]: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>
            {columnFilters[id] && (
               <div className="px-2 pb-2">
                  <button 
                    className="w-full text-xs text-blue-600 hover:text-blue-700 font-medium py-1"
                    onClick={() => setColumnFilters(prev => { const n = {...prev}; delete n[id]; return n; })}
                  >
                    Clear Filter
                  </button>
               </div>
            )}
          </div>
        </div>
      )}
    </th>
  );

  return (
    <div className="space-y-6 max-w-full w-full mx-auto pb-32">
      <DeadlineWarningBanner />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
        <div>
          <h2 className="text-[22px] font-semibold text-slate-900 mb-1">Dashboard</h2>
          <p className="text-slate-500 text-sm">Welcome back, {userName}</p>
        </div>
        <button 
          onClick={() => navigate('/tenders')}
          className="flex flex-none justify-center items-center gap-2 bg-[#2563eb] hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm w-full sm:w-auto"
        >
          <Plus size={16} />
          Upload Tender Documents
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {/* Total Experts */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 flex justify-between items-start shadow-sm">
          <div>
            <h3 className="text-[13px] font-semibold text-slate-600 mb-2">Total Experts</h3>
            <p className="text-[32px] leading-none font-bold text-slate-900">{stats.totalExperts || 0}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#eff6ff] text-[#3b82f6] flex items-center justify-center">
            <Users size={24} className="fill-current bg-transparent opacity-80" />
          </div>
        </div>

        {/* Tenders Uploaded */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 flex justify-between items-start shadow-sm">
          <div>
            <h3 className="text-[13px] font-semibold text-slate-600 mb-2">Tenders Uploaded</h3>
            <p className="text-[32px] leading-none font-bold text-slate-900">{stats.activeTenders || 0}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#fff7ed] text-[#f97316] flex items-center justify-center">
            <FileText size={24} className="fill-current bg-transparent opacity-80" />
          </div>
        </div>

        {/* CVs Generated */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 flex justify-between items-start shadow-sm">
          <div>
            <h3 className="text-[13px] font-semibold text-slate-600 mb-2">CVs Generated</h3>
            <p className="text-[32px] leading-none font-bold text-slate-900">{stats.cvsGenerated || 0}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#f0fdf4] text-[#22c55e] flex items-center justify-center">
            <FileText size={24} className="fill-current bg-transparent opacity-80" />
          </div>
        </div>

        {/* Match Rate */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 flex justify-between items-start shadow-sm">
          <div>
            <h3 className="text-[13px] font-semibold text-slate-600 mb-2">Match rate</h3>
            <p className="text-[32px] leading-none font-bold text-slate-900">{stats.matchRate || 0}%</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#faf5ff] text-[#a855f7] flex items-center justify-center">
            <BarChart2 size={24} className="fill-current bg-transparent opacity-80" />
          </div>
        </div>
      </div>

      {/* Latest Tenders Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-[15px] font-semibold text-slate-900">Latest tenders</h3>
          <Link to="/tenders" className="text-sm font-medium text-[#2563eb] hover:text-blue-700">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500 font-semibold bg-white">
                {renderColumnHeader('internal_code', 'INTERNAL CODE')}
                {renderColumnHeader('name', 'NAME')}
                {renderColumnHeader('description', 'DESCRIPTION')}
                {renderColumnHeader('type', 'TYPE')}
                {renderColumnHeader('client', 'CLIENT')}
                {renderColumnHeader('status', 'STATUS')}
                {renderColumnHeader('matchRate', 'MATCH RATE')}
                <th className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredTenders.length > 0 ? (
                filteredTenders.map((tender) => (
                  <tr key={tender.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => navigate(`/matches?tenderId=${tender.id}`)}>
                    <td className="px-6 py-4 text-sm text-slate-900" onClick={(e) => e.stopPropagation()}>{tender.internal_code || tender.id?.slice(0, 8).toUpperCase() || '-'}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">{tender.name || tender.tender_title || 'Untitled Tender'}</td>
                    <td className="px-6 py-4 text-sm text-slate-500 truncate max-w-[400px]">{tender.background || tender.description || '-'}</td>
                    <td className="px-6 py-4 text-sm text-slate-500 truncate max-w-[200px]">{(tender.project_sector && tender.project_sector.length > 0) ? tender.project_sector.join(', ') : (tender.tender_format || "GEN-X1")}</td>
                    <td className="px-6 py-4 text-sm text-slate-500 truncate max-w-[200px]">{tender.client || "Confidential Authority"}</td>
                    <td className="px-6 py-4">
                      {tender.status === 'Matching Completed' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100/50">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
                          {tender.status}
                        </span>
                      ) : tender.status?.includes('Partial') || tender.status === 'Tender Extraction Completed' || tender.status?.includes('Processing') ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100/50">
                          <div className={`w-1.5 h-1.5 rounded-full bg-amber-500 ${tender.status?.includes('Processing') ? 'animate-pulse' : ''}`}></div>
                          {tender.status}
                        </span>
                      ) : tender.status?.includes('Failed') ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-100/50">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                          {tender.status}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          {tender.status || 'Tender Extraction Completed'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{matchRates[tender.id] || "-"}</td>
                    <td className="px-6 py-4 text-sm text-right">
                      {/* Removing match button as per request */}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-[13px] text-slate-500 bg-[#fafafa]">
                    No tenders found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
