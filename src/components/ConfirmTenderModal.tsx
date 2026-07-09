import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Save, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';

interface ConfirmTenderModalProps {
  tender: any;
  onSave: (tender: any) => Promise<void>;
  onCancel: () => void;
}

const toArray = (value: any): string[] => Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : value ? [String(value).trim()].filter(Boolean) : [];
const joinLines = (value: any) => toArray(value).join('\n');
const splitLines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);

export function ConfirmTenderModal({ tender, onSave, onCancel }: ConfirmTenderModalProps) {
  const [editedTender, setEditedTender] = useState({
    ...tender,
    name: tender.name || tender.tender_title || '',
    internal_code: tender.internal_code || tender.tender_number || `TEN-${Math.floor(Math.random()*10000)}`,
    client: tender.client || '',
    scope_summary: tender.scope_summary || '',
    special_requirements: toArray(tender.special_requirements),
    global_team_constraints: toArray(tender.global_team_constraints),
    tender_format: tender.tender_format || 'GEN-X1',
    positions: tender.positions?.map((p: any) => ({ ...p })) || [],
    branding: tender.branding || { header_base64: "", footer_base64: "", header_name: "", footer_name: "" }
  });
  const [isSaving, setIsSaving] = useState(false);
  const [savedBranding, setSavedBranding] = useState({ header_base64: "", footer_base64: "", header_name: "", footer_name: "" });
  const [brandingSelection, setBrandingSelection] = useState("default");

  useEffect(() => {
    async function loadGlobalBranding() {
      const globalBranding = await api.getGlobalBranding();
      setSavedBranding(globalBranding || { header_base64: "", footer_base64: "", header_name: "", footer_name: "" });
      setEditedTender((prev: any) => ({
        ...prev,
        branding: {
          header_base64: globalBranding.header_base64 || "",
          footer_base64: globalBranding.footer_base64 || "",
          header_name: globalBranding.header_name || "",
          footer_name: globalBranding.footer_name || "",
          source: "globalBranding",
        }
      }));
    }
    loadGlobalBranding();
  }, []);

  const handlePositionChange = (idx: number, field: string, value: any) => {
    const newPositions = [...editedTender.positions];
    newPositions[idx] = { ...newPositions[idx], [field]: value };
    setEditedTender({ ...editedTender, positions: newPositions });
  };

  const handleBrandingSelection = (value: string) => {
    setBrandingSelection(value);
    setEditedTender((prev: any) => ({
      ...prev,
      branding: value === "default"
        ? {
            header_base64: savedBranding.header_base64 || "",
            footer_base64: savedBranding.footer_base64 || "",
            header_name: savedBranding.header_name || "",
            footer_name: savedBranding.footer_name || "",
            source: "globalBranding",
          }
        : {
            header_base64: "",
            footer_base64: "",
            header_name: "",
            footer_name: "",
            source: "none",
          },
    }));
  };

  const handleSave = async () => {
    if (!editedTender.internal_code || !editedTender.internal_code.trim()) {
      alert("Internal Code is required.");
      return;
    }
    if (!String(editedTender.name || editedTender.tender_title || editedTender.client || '').trim() && (!Array.isArray(editedTender.positions) || editedTender.positions.length === 0)) {
      alert("Tender extraction is empty. Please re-upload the tender and wait for extraction to complete before saving.");
      return;
    }
    if (!Array.isArray(editedTender.positions) || editedTender.positions.length === 0) {
      alert("No tender positions were extracted. Please re-upload the tender and wait for extraction to complete before saving.");
      return;
    }
    setIsSaving(true);
    await onSave(editedTender);
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <AlertCircle size={20} className="text-amber-500" />
              Human-in-the-Loop Verification
            </h2>
            <p className="text-sm text-slate-500 mt-1">Review and confirm the AI-extracted tender requirements before matching.</p>
          </div>
          <button 
            onClick={onCancel}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Internal Code</label>
              <input 
                type="text" 
                value={editedTender.internal_code || ''}
                onChange={e => setEditedTender({...editedTender, internal_code: e.target.value})}
                placeholder="e.g. TEN-001"
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Tender Name</label>
              <input 
                type="text" 
                value={editedTender.name}
                onChange={e => setEditedTender({...editedTender, name: e.target.value})}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Client Authority</label>
              <input 
                type="text" 
                value={editedTender.client}
                onChange={e => setEditedTender({...editedTender, client: e.target.value})}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Document Format / Source</label>
              <input 
                type="text" 
                value={editedTender.tender_format}
                onChange={e => setEditedTender({...editedTender, tender_format: e.target.value})}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Tender Context</h3>
              <p className="text-xs text-slate-500 mt-1">Confirm the extracted scope and team-level requirements before matching.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Scope Summary</label>
              <textarea
                value={editedTender.scope_summary || ''}
                onChange={e => setEditedTender({ ...editedTender, scope_summary: e.target.value })}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all min-h-[120px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Special Requirements</label>
                <textarea
                  value={joinLines(editedTender.special_requirements)}
                  onChange={e => setEditedTender({ ...editedTender, special_requirements: splitLines(e.target.value) })}
                  placeholder="One requirement per line"
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all min-h-[110px]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Global Team Constraints</label>
                <textarea
                  value={joinLines(editedTender.global_team_constraints)}
                  onChange={e => setEditedTender({ ...editedTender, global_team_constraints: splitLines(e.target.value) })}
                  placeholder="One team-level constraint per line"
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all min-h-[110px]"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Extracted Positions ({editedTender.positions.length})</h3>
            </div>
            
            <div className="space-y-4">
              {editedTender.positions.map((pos: any, idx: number) => (
                <div key={idx} className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Position Title</label>
                      <input 
                        type="text" 
                        value={pos.position_title || pos.title || ''}
                        onChange={e => handlePositionChange(idx, 'position_title', e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm font-medium focus:border-blue-500 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Quantities Needed</label>
                      <input 
                        type="number" 
                        value={pos.quantity || 1}
                        onChange={e => handlePositionChange(idx, 'quantity', parseInt(e.target.value))}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Years Exp Reqd.</label>
                      <input 
                        type="number" 
                        value={pos.minimum_years_experience || pos.years_experience || pos.required_years || 0}
                        onChange={e => handlePositionChange(idx, 'minimum_years_experience', parseInt(e.target.value))}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Nationality Quota</label>
                      <input 
                        type="text" 
                        value={pos.nationality_preference || 'Any'}
                        onChange={e => handlePositionChange(idx, 'nationality_preference', e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-1 mt-4">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Education Requirement</label>
                    <textarea 
                      value={pos.minimum_education || ''}
                      onChange={e => handlePositionChange(idx, 'minimum_education', e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none min-h-[40px]"
                    />
                  </div>
                  
                  <div className="space-y-1 mt-4">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Role Description</label>
                    <textarea 
                      value={pos.role_description || ''}
                      onChange={e => handlePositionChange(idx, 'role_description', e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none min-h-[60px]"
                    />
                  </div>

                  <div className="space-y-1 mt-4">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">General Experience</label>
                    <textarea 
                      value={pos.general_experience || ''}
                      onChange={e => handlePositionChange(idx, 'general_experience', e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none min-h-[60px]"
                    />
                  </div>

                  <div className="space-y-1 mt-4">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Specific Experience</label>
                    <textarea 
                      value={pos.specific_experience || ''}
                      onChange={e => handlePositionChange(idx, 'specific_experience', e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none min-h-[60px]"
                    />
                  </div>
                </div>
              ))}
              
              {editedTender.positions.length === 0 && (
                <div className="px-6 py-8 text-center border-2 border-dashed border-slate-200 rounded-xl text-slate-500 text-sm">
                  No positions extracted by AI. You may need to cancel and try again or edit the source document.
                </div>
              )}
            </div>
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Tender Branding</h3>
            </div>

            <div className="mb-4 max-w-sm">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Branding Source</label>
              <select
                value={brandingSelection}
                onChange={(e) => handleBrandingSelection(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="default">Saved default branding</option>
                <option value="none">No branding</option>
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Document Header</label>
                <p className="text-xs text-slate-500">Best fit: 1800 x 250 px</p>
                <div className="relative aspect-[36/5] bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center overflow-hidden group hover:border-blue-500/50 transition-colors">
                  {editedTender.branding?.header_base64 ? (
                    <img src={editedTender.branding.header_base64} className="w-full h-full object-contain" alt="Header preview" />
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                       <ImageIcon size={20} className="text-slate-400" />
                       <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter text-center">No saved<br/>Header</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {editedTender.branding?.header_name ? `Using ${editedTender.branding.header_name}` : 'No saved header'}
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Document Footer</label>
                <p className="text-xs text-slate-500">Best fit: 1800 x 120 px</p>
                <div className="relative aspect-[15/1] min-h-[44px] bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center overflow-hidden group hover:border-blue-500/50 transition-colors">
                  {editedTender.branding?.footer_base64 ? (
                    <img src={editedTender.branding.footer_base64} className="w-full h-full object-contain" alt="Footer preview" />
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                       <ImageIcon size={20} className="text-slate-400" />
                       <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter text-center">No saved<br/>Footer</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {editedTender.branding?.footer_name ? `Using ${editedTender.branding.footer_name}` : 'No saved footer'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-white flex items-center justify-end gap-3">
          <button 
            onClick={onCancel}
            disabled={isSaving}
            className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors border border-slate-200"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving || !Array.isArray(editedTender.positions) || editedTender.positions.length === 0}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium bg-[#2563eb] hover:bg-blue-700 text-white transition-colors shadow-sm disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Confirm & Save Tender
          </button>
        </div>
      </motion.div>
    </div>
  );
}
