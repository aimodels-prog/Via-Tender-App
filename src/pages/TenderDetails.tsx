import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText, ArrowLeft, Building2, MapPin, Briefcase, Calendar, Target, Clock, ShieldCheck, CheckCircle, Pencil } from 'lucide-react';
import { api } from '../lib/api';

export default function TenderDetails() {
  const { tenderId } = useParams();
  const [tender, setTender] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditingDeadline, setIsEditingDeadline] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState('');

  useEffect(() => {
    async function loadTender() {
      if (!tenderId) return;
      const data = await api.getTender(tenderId);
      setTender(data);
      if (data?.deadline) {
        setDeadlineInput(data.deadline);
      }
      setLoading(false);
    }
    loadTender();
  }, [tenderId]);

  const handleSaveDeadline = async () => {
    if (!tenderId) return;
    try {
      const updated = await api.updateTender(tenderId, { deadline: deadlineInput });
      if (updated) {
        setTender(updated);
      }
      setIsEditingDeadline(false);
    } catch (err) {
      console.error(err);
    }
  };

  const isCloseToDeadline = (deadlineStr: string) => {
    if (!deadlineStr) return false;
    const deadline = new Date(deadlineStr);
    const now = new Date();
    const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 3600 * 24));
    return diffDays >= 0 && diffDays <= 7;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!tender) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-slate-900">Tender not found</h2>
        <Link to="/tenders" className="text-blue-600 hover:underline mt-4 inline-block">Back to Tenders</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Link to="/tenders" className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tender.name || tender.tender_title || 'Untitled Tender'}</h1>
          <p className="text-slate-500 text-sm mt-1">ID: {tender.internal_code ? tender.internal_code : `#${tender.id?.toString().substring(0,8).toUpperCase()}`}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <FileText className="text-blue-600" size={20} />
                Scope Summary
              </h2>
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">
                {tender.scope_summary || "No scope summary extracted."}
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <ShieldCheck className="text-emerald-600" size={20} />
                Special Requirements
              </h2>
              <ul className="space-y-2">
                {tender.special_requirements?.length > 0 ? (
                  tender.special_requirements.map((req: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                      <CheckCircle size={16} className="text-slate-400 mt-0.5 shrink-0" />
                      <span>{req}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-slate-500 italic">No special requirements specified.</li>
                )}
              </ul>
            </div>
            
            <div>
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <Briefcase className="text-blue-600" size={20} />
                Required Positions
              </h2>
              <div className="space-y-4">
                {tender.positions?.length > 0 ? (
                  tender.positions.map((pos: any, i: number) => (
                    <div key={i} className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                      <div className="flex items-start justify-between">
                        <h4 className="font-semibold text-slate-900 text-sm">{pos.position_title || pos.title || 'Unnamed Position'}</h4>
                        <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                          Qty: {pos.quantity || 1}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600">
                        <div>
                          <span className="font-medium block mb-1">Experience</span>
                          {pos.minimum_years_experience || pos.min_years_experience || 0} years required
                        </div>
                        <div>
                          <span className="font-medium block mb-1">Education</span>
                          {pos.minimum_education || "Not specified"}
                        </div>
                        {pos.role_description && (
                          <div className="sm:col-span-2">
                            <span className="font-medium block mb-1">Role Description</span>
                            {pos.role_description}
                          </div>
                        )}
                        {pos.general_experience && (
                          <div className="sm:col-span-2">
                            <span className="font-medium block mb-1">General Experience</span>
                            {pos.general_experience}
                          </div>
                        )}
                        {pos.specific_experience && (
                          <div className="sm:col-span-2">
                            <span className="font-medium block mb-1">Specific Experience</span>
                            {pos.specific_experience}
                          </div>
                        )}
                        {pos.required_sector_experience && pos.required_sector_experience.length > 0 && (
                          <div className="sm:col-span-2">
                            <span className="font-medium block mb-1">Sector Experience</span>
                            {pos.required_sector_experience.join(', ')}
                          </div>
                        )}
                        {pos.mandatory_skills && pos.mandatory_skills.length > 0 && (
                          <div className="sm:col-span-2">
                            <span className="font-medium block mb-1">Mandatory Skills</span>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {pos.mandatory_skills.map((skill: string, idx: number) => (
                                <span key={idx} className="bg-white border border-slate-200 px-2 py-1 rounded text-slate-600">
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 italic">No positions extracted.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
             <h2 className="text-lg font-semibold text-slate-900 mb-4">Tender Info</h2>
             <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Building2 size={18} className="text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="block text-xs font-medium text-slate-500 uppercase">Client</span>
                    <span className="text-sm text-slate-900">{tender.client || 'Unknown'}</span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin size={18} className="text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="block text-xs font-medium text-slate-500 uppercase">Country</span>
                    <span className="text-sm text-slate-900">{tender.country || 'Not specified'}</span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Target size={18} className="text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="block text-xs font-medium text-slate-500 uppercase">Project Sectors</span>
                    <span className="text-sm text-slate-900">
                      {tender.project_sector?.length > 0 ? tender.project_sector.join(', ') : 'None'}
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock size={18} className="text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="block text-xs font-medium text-slate-500 uppercase">Duration</span>
                    <span className="text-sm text-slate-900">{tender.duration || 'Not specified'}</span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar size={18} className="text-slate-400 mt-0.5 shrink-0" />
                  <div className="w-full">
                    <span className="block text-xs font-medium text-slate-500 uppercase">Deadline</span>
                    {isEditingDeadline ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input 
                          type="date"
                          value={deadlineInput}
                          onChange={(e) => setDeadlineInput(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                        />
                        <button 
                          onClick={handleSaveDeadline}
                          className="text-sm bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition"
                        >
                          Save
                        </button>
                        <button 
                          onClick={() => { setIsEditingDeadline(false); setDeadlineInput(tender.deadline || ''); }}
                          className="text-sm bg-slate-200 text-slate-700 px-2 py-1 rounded hover:bg-slate-300 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingDeadline(true)}>
                        <span className={`text-sm font-medium ${tender.deadline && isCloseToDeadline(tender.deadline) ? 'text-red-600' : 'text-slate-900'}`}>
                          {tender.deadline ? new Date(tender.deadline).toLocaleDateString() : 'Not specified'}
                        </span>
                        {tender.deadline && isCloseToDeadline(tender.deadline) && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-600 px-1.5 py-0.5 rounded">
                            Closing Soon
                          </span>
                        )}
                        <Pencil size={14} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar size={18} className="text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="block text-xs font-medium text-slate-500 uppercase">Extracted On</span>
                    <span className="text-sm text-slate-900">
                      {tender.created_at ? new Date(tender.created_at).toLocaleDateString() : 'Unknown'}
                    </span>
                  </div>
                </div>
             </div>
             
             <div className="mt-8">
               <Link 
                  to={`/tenders/${tender.id}`} 
                  className="w-full flex flex-col items-center justify-center py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors shadow-sm"
                >
                  <span className="flex items-center gap-2 block"><Target size={18} /> Start Matching Engine</span>
                </Link>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
