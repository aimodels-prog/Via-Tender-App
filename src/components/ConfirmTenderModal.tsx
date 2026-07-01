import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Save, Layers, User, Calendar, Edit2, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';

interface ConfirmTenderModalProps {
  tender: any;
  onSave: (tender: any) => Promise<void>;
  onCancel: () => void;
}

export function ConfirmTenderModal({ tender, onSave, onCancel }: ConfirmTenderModalProps) {
  const [editedTender, setEditedTender] = useState({
    ...tender,
    name: tender.name || tender.tender_title || '',
    internal_code: tender.internal_code || tender.tender_number || `TEN-${Math.floor(Math.random()*10000)}`,
    client: tender.client || '',
    tender_format: tender.tender_format || 'GEN-X1',
    positions: tender.positions?.map((p: any) => ({ ...p })) || [],
    branding: tender.branding || { header_base64: "", footer_base64: "", header_name: "", footer_name: "" }
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadGlobalBranding() {
      const globalBranding = await api.getGlobalBranding();
      setEditedTender((prev: any) => ({
        ...prev,
        branding: {
          ...prev.branding,
          header_base64: prev.branding?.header_base64 || globalBranding.header_base64 || "",
          footer_base64: prev.branding?.footer_base64 || globalBranding.footer_base64 || "",
          header_name: prev.branding?.header_name || globalBranding.header_name || "",
          footer_name: prev.branding?.footer_name || globalBranding.footer_name || "",
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'header' | 'footer') => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const maxFileSizeMb = 1;
    if (file.size > maxFileSizeMb * 1024 * 1024) {
      alert(`Image is too large. Please select an image under ${maxFileSizeMb}MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 800; // Headers/footers usually wide
        
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round(height * (MAX_WIDTH / width));
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round(width * (MAX_HEIGHT / height));
            height = MAX_HEIGHT;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        const compressedBase64 = canvas.toDataURL('image/png'); // DOCX supports PNG/JPG/GIF/BMP reliably.
        
        setEditedTender((prev: any) => ({
          ...prev,
          branding: {
            ...prev.branding,
            [type === 'header' ? 'header_base64' : 'footer_base64']: compressedBase64,
            [type === 'header' ? 'header_name' : 'footer_name']: file.name
          }
        }));
      };
      
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!editedTender.internal_code || !editedTender.internal_code.trim()) {
      alert("Internal Code is required.");
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
                       <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter text-center">Upload Tender<br/>Header</span>
                    </div>
                  )}
                  <label className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity z-10">
                    <span className="text-[10px] font-bold text-white uppercase tracking-widest">Update Image</span>
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'header')} />
                  </label>
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
                       <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter text-center">Upload Tender<br/>Footer</span>
                    </div>
                  )}
                  <label className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity z-10">
                    <span className="text-[10px] font-bold text-white uppercase tracking-widest">Update Image</span>
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'footer')} />
                  </label>
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
            disabled={isSaving}
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
