import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Save, ShieldAlert, Plus, Trash2 } from 'lucide-react';
import { ALL_PRIMARY_POSITIONS } from '../lib/constants';

interface ConfigRequirementsModalProps {
  tender: any;
  onSave: (updatedTender: any) => Promise<void>;
  onClose: () => void;
}

export function ConfigRequirementsModal({ tender, onSave, onClose }: ConfigRequirementsModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [positions, setPositions] = useState<any[]>(tender?.requirements?.positions || []);
  const [nationalityObj, setNationalityObj] = useState<any>(tender?.requirements?.nationality_requirements || {
    required_percentage: 0,
    preferred_nationalities: []
  });

  const handleSave = async () => {
    setIsSaving(true);
    const updated = {
      ...tender,
      requirements: {
        ...(tender.requirements || {}),
        positions: positions,
        nationality_requirements: nationalityObj
      }
    };
    await onSave(updated);
    setIsSaving(false);
    onClose();
  };

  const updatePosition = (index: number, field: string, value: any) => {
    const newPositions = [...positions];
    newPositions[index] = { ...newPositions[index], [field]: value };
    setPositions(newPositions);
  };

  const removePosition = (index: number) => {
    setPositions(positions.filter((_, i) => i !== index));
  };

  const addPosition = () => {
    setPositions([...positions, {
      title: 'New Position',
      mandatory_skills: [],
      min_years_experience: 0
    }]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl flex flex-col overflow-hidden max-h-[90vh]"
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Configure Requirements</h2>
            <p className="text-sm text-slate-500 mt-1">Edit required positions and quotas for {tender.name}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-8 flex-1">
          {/* Quota Management */}
          <section className="space-y-4">
            <h3 className="text-base font-semibold text-slate-800">Nationality & Localization Quota</h3>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Required Local %</label>
                  <input 
                    type="number"
                    min="0"
                    max="100"
                    value={nationalityObj.required_percentage || 0}
                    onChange={(e) => setNationalityObj({...nationalityObj, required_percentage: parseInt(e.target.value) || 0})}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                  />
                  <p className="text-xs text-slate-500">Warning if team drops below this %</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Preferred Nationalities (Comma-separated)</label>
                  <input 
                    type="text"
                    value={nationalityObj.preferred_nationalities?.join(', ') || ''}
                    onChange={(e) => setNationalityObj({...nationalityObj, preferred_nationalities: e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                    placeholder="e.g. Omani, Saudi"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Positions */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Required Positions</h3>
              <button onClick={addPosition} className="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1">
                <Plus size={14} /> Add Position
              </button>
            </div>
            
            <div className="space-y-3">
              {positions.map((pos, idx) => (
                <div key={idx} className="bg-white border text-left border-slate-200 rounded-xl p-4 flex gap-4">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-500">Position Title</label>
                      <input 
                        type="text" 
                        value={pos.title || ''} 
                        onChange={e => updatePosition(idx, 'title', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-500">Min. Exp (Years)</label>
                      <input 
                        type="number" 
                        value={pos.min_years_experience || 0} 
                        onChange={e => updatePosition(idx, 'min_years_experience', parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-500">Taxonomy Mapping</label>
                      <select 
                        value={pos.mapped_role || ''} 
                        onChange={e => updatePosition(idx, 'mapped_role', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                      >
                        <option value="">-- Match Taxonomy --</option>
                        {ALL_PRIMARY_POSITIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-500">Mandatory Skills (Comma-separated)</label>
                      <input 
                        type="text" 
                        value={(pos.mandatory_skills || []).join(', ')} 
                        onChange={e => updatePosition(idx, 'mandatory_skills', e.target.value.split(',').map(s=>s.trim()).filter(Boolean))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <button onClick={() => removePosition(idx)} className="text-slate-400 hover:text-red-500 transition-colors p-2 shrink-0">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </section>

        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
          <button 
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? "Saving..." : "Save Requirements"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
