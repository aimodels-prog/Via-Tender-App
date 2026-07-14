import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Save, AlertCircle, Loader2, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { getTenderPositionWarnings, normalizeTenderRecord } from '../lib/tenderPostProcess';

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
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const normalizedForReview = useMemo(() => normalizeTenderRecord(editedTender), [editedTender]);
  const blockingIssues = toArray(normalizedForReview.extraction_blocking_issues);
  const isTechnicalAuditWarning = (warning: string) => /(?:source page evidence|field-level evidence)/i.test(warning);
  const positionWarnings = useMemo(
    () => normalizedForReview.positions.map((position: any) => getTenderPositionWarnings(position).filter((warning) => !isTechnicalAuditWarning(warning))),
    [normalizedForReview.positions],
  );
  const tenderWarnings = toArray(normalizedForReview.extraction_warnings).filter((warning) => !isTechnicalAuditWarning(warning) &&
    !positionWarnings.some((warnings: string[]) => warnings.some((positionWarning) => warning.endsWith(positionWarning))),
  );
  const warningCount = positionWarnings.reduce((count: number, warnings: string[]) => count + warnings.length, 0) + tenderWarnings.length;

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
    setWarningsAcknowledged(false);
  };

  const removePosition = (idx: number) => {
    setEditedTender({ ...editedTender, positions: editedTender.positions.filter((_: any, index: number) => index !== idx) });
    setWarningsAcknowledged(false);
  };

  const addPosition = () => {
    setEditedTender({
      ...editedTender,
      positions: [...editedTender.positions, {
        position_title: '', quantity: undefined, minimum_years_experience: undefined,
        nationality_preference: '', minimum_education: '', role_description: '',
        general_experience: '', specific_experience: '', source_page_numbers: [], source_quotes: [],
      }],
    });
    setWarningsAcknowledged(false);
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
    if (blockingIssues.length > 0) {
      alert(`Critical extraction issues must be resolved before saving: ${blockingIssues.join(' ')}`);
      return;
    }
    if (warningCount > 0 && !warningsAcknowledged) {
      alert("Review the extraction warnings and acknowledge them before saving.");
      return;
    }
    setIsSaving(true);
    await onSave(normalizedForReview);
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
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

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-8">
          {blockingIssues.length > 0 && (
            <div className="border border-red-300 bg-red-50 rounded-lg p-4 text-sm text-red-900">
              <p className="font-semibold">Extraction cannot be saved yet</p>
              <ul className="mt-2 list-disc pl-5 space-y-1">
                {blockingIssues.map((issue, index) => <li key={index}>{issue}</li>)}
              </ul>
            </div>
          )}
          {tenderWarnings.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm text-amber-900">
              <p className="font-semibold">Extraction needs attention</p>
              <ul className="mt-2 list-disc pl-5 space-y-1">
                {tenderWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            {[
              ['country', 'Country'],
              ['tender_number', 'Tender Number'],
              ['deadline', 'Submission Deadline'],
              ['duration', 'Project Duration'],
              ['submission_type', 'Submission Type'],
            ].map(([field, label]) => (
              <div className="space-y-2" key={field}>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{label}</label>
                <input
                  type="text"
                  value={(editedTender as any)[field] || ''}
                  placeholder="Not extracted"
                  onChange={e => setEditedTender({ ...editedTender, [field]: e.target.value })}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
            ))}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                ['project_sector', 'Project Sectors'],
                ['objectives', 'Objectives'],
                ['deliverables', 'Deliverables'],
                ['eligibility_requirements', 'Eligibility Requirements'],
                ['evaluation_criteria', 'Evaluation Criteria'],
              ].map(([field, label]) => (
                <div className="space-y-2" key={field}>
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{label}</label>
                  <textarea
                    value={joinLines((editedTender as any)[field])}
                    onChange={e => setEditedTender({ ...editedTender, [field]: splitLines(e.target.value) })}
                    placeholder="One item per line"
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none min-h-[100px]"
                  />
                </div>
              ))}
            </div>

          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Extracted Positions ({editedTender.positions.length})</h3>
              <button type="button" onClick={addPosition} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 rounded-lg">
                <Plus size={16} /> Add position
              </button>
            </div>
            
            <div className="space-y-4">
              {editedTender.positions.map((pos: any, idx: number) => (
                <div key={idx} className="p-4 border border-slate-200 rounded-lg bg-slate-50/50">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-500">Position {idx + 1}</p>
                      {positionWarnings[idx]?.length > 0 && (
                        <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                          {positionWarnings[idx].join(' ')}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => removePosition(idx)} title="Remove position" className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="md:col-span-2 space-y-1">
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
                        value={pos.quantity ?? ''}
                        placeholder="Not extracted"
                        onChange={e => handlePositionChange(idx, 'quantity', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Years Exp Reqd.</label>
                      <input 
                        type="number" 
                        value={pos.minimum_years_experience ?? pos.years_experience ?? pos.required_years ?? ''}
                        placeholder="Not extracted"
                        onChange={e => handlePositionChange(idx, 'minimum_years_experience', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Nationality Quota</label>
                      <input 
                        type="text" 
                        value={pos.nationality_preference || ''}
                        placeholder="Not stated"
                        onChange={e => handlePositionChange(idx, 'nationality_preference', e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    {[
                      ['lot_reference', 'Lot / Package', 'text'],
                      ['input_months', 'Input Months', 'number'],
                      ['work_location', 'Work Location', 'text'],
                      ['minimum_specific_years', 'Specific Years', 'number'],
                      ['minimum_similar_projects', 'Similar Projects', 'number'],
                      ['evaluation_points', 'Evaluation Points', 'number'],
                    ].map(([field, label, type]) => (
                      <div className="space-y-1" key={field}>
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
                        <input
                          type={type}
                          value={pos[field] ?? ''}
                          placeholder="Not extracted"
                          onChange={e => handlePositionChange(idx, field, type === 'number' ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none"
                        />
                      </div>
                    ))}
                    <label className="flex items-center gap-2 text-sm text-slate-700 pt-5">
                      <input type="checkbox" checked={Boolean(pos.is_key_expert)} onChange={e => handlePositionChange(idx, 'is_key_expert', e.target.checked)} />
                      Key expert
                    </label>
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    {[
                      ['regional_experience', 'Regional Experience'],
                      ['country_experience', 'Country Experience'],
                    ].map(([field, label]) => (
                      <div className="space-y-1" key={field}>
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
                        <textarea value={pos[field] || ''} onChange={e => handlePositionChange(idx, field, e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none min-h-[60px]" />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    {[
                      ['required_sector_experience', 'Required Sector Experience'],
                      ['mandatory_skills', 'Mandatory Skills'],
                      ['required_software', 'Required Software'],
                      ['required_certifications', 'Required Certifications'],
                      ['professional_memberships', 'Professional Memberships'],
                      ['required_languages', 'Required Languages'],
                      ['position_deliverables', 'Position Deliverables'],
                      ['required_keywords', 'Required Keywords'],
                    ].map(([field, label]) => (
                      <div className="space-y-1" key={field}>
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
                        <textarea
                          value={joinLines(pos[field])}
                          placeholder="One item per line"
                          onChange={e => handlePositionChange(idx, field, splitLines(e.target.value))}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:border-blue-500 outline-none min-h-[70px]"
                        />
                      </div>
                    ))}
                  </div>

                </div>
              ))}
              
              {editedTender.positions.length === 0 && (
                <div className="px-6 py-8 text-center border-2 border-dashed border-slate-200 rounded-xl text-slate-500 text-sm">
                  No positions extracted by AI. You may need to cancel and try again or edit the source document.
                </div>
              )}
            </div>
            {warningCount > 0 && (
              <label className="mt-5 flex items-start gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg text-sm text-amber-900">
                <input type="checkbox" checked={warningsAcknowledged} onChange={e => setWarningsAcknowledged(e.target.checked)} className="mt-0.5" />
                <span>I reviewed {warningCount} extraction warning{warningCount === 1 ? '' : 's'} against the source tender and approve the remaining missing information.</span>
              </label>
            )}
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
            disabled={isSaving || blockingIssues.length > 0 || !Array.isArray(editedTender.positions) || editedTender.positions.length === 0}
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
