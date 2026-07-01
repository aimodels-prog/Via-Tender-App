import React, { useEffect, useState } from 'react';
import { X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { api } from '../lib/api';

interface BrandingModalProps {
  tender: any;
  onClose: () => void;
  onSave: () => void;
}

export function BrandingModal({ tender, onClose, onSave }: BrandingModalProps) {
  const [branding, setBranding] = useState(tender.branding || {
    header_base64: "",
    footer_base64: "",
    header_name: "",
    footer_name: ""
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadDefaults() {
      const globalBranding = await api.getGlobalBranding();
      setBranding((prev: any) => ({
        ...prev,
        header_base64: prev.header_base64 || globalBranding.header_base64 || "",
        footer_base64: prev.footer_base64 || globalBranding.footer_base64 || "",
        header_name: prev.header_name || globalBranding.header_name || "",
        footer_name: prev.footer_name || globalBranding.footer_name || "",
      }));
    }
    loadDefaults();
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'header' | 'footer') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setBranding((prev: any) => ({
        ...prev,
        [type === 'header' ? 'header_base64' : 'footer_base64']: reader.result,
        [type === 'header' ? 'header_name' : 'footer_name']: file.name
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.updateTenderBranding(tender.id, branding);
      onSave();
      onClose();
    } catch (err) {
      console.error(err);
      alert("Failed to save branding settings.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4 sm:p-6">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.95, opacity: 0 }} 
        className="relative w-full max-w-2xl bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xl flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Technical Output Branding</h2>
            <p className="text-sm text-slate-500 mt-0.5">Tender: {tender.name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-6 overflow-y-auto">
          <section className="space-y-4">
            <h4 className="text-sm font-semibold text-slate-800">Visual Identity (Headers & Footers)</h4>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block">Document Header</label>
                <p className="text-xs text-slate-500">Best fit: 1800 x 250 px</p>
                <div className="relative aspect-[36/5] bg-slate-50 border-2 border-slate-300 border-dashed rounded-lg flex items-center justify-center overflow-hidden group hover:border-blue-500 transition-colors">
                  {branding.header_base64 ? (
                    <img src={branding.header_base64} className="w-full h-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5">
                       <ImageIcon size={24} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                       <span className="text-xs font-medium text-slate-500 group-hover:text-blue-600 transition-colors text-center">Upload Template<br/>Header</span>
                    </div>
                  )}
                  <label className="absolute inset-0 bg-white/70 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity z-10 font-semibold text-blue-600 text-sm backdrop-blur-[1px]">
                    Update Image
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'header')} />
                  </label>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {branding.header_name ? `Using ${branding.header_name}` : 'No saved header'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block">Document Footer</label>
                <p className="text-xs text-slate-500">Best fit: 1800 x 120 px</p>
                <div className="relative aspect-[15/1] min-h-[44px] bg-slate-50 border-2 border-slate-300 border-dashed rounded-lg flex items-center justify-center overflow-hidden group hover:border-blue-500 transition-colors">
                  {branding.footer_base64 ? (
                    <img src={branding.footer_base64} className="w-full h-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5">
                       <ImageIcon size={24} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                       <span className="text-xs font-medium text-slate-500 group-hover:text-blue-600 transition-colors text-center">Upload Template<br/>Footer</span>
                    </div>
                  )}
                  <label className="absolute inset-0 bg-white/70 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity z-10 font-semibold text-blue-600 text-sm backdrop-blur-[1px]">
                    Update Image
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'footer')} />
                  </label>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {branding.footer_name ? `Using ${branding.footer_name}` : 'No saved footer'}
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0 rounded-b-xl">
           <div className="flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
             <span className="text-sm font-medium text-slate-600">Saved defaults are used unless this tender overrides them</span>
           </div>
           <div className="flex items-center gap-3">
             <button type="button" onClick={onClose} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors shadow-sm">
                Cancel
             </button>
             <button 
               onClick={handleSave}
               disabled={isSaving}
               className="px-5 py-2.5 bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors shadow-sm flex items-center gap-2"
             >
               {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
               {isSaving ? "Syncing..." : "Apply Tender Branding"}
             </button>
           </div>
        </div>
      </motion.div>
    </div>
  );
}
