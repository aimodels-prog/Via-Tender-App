import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, RefreshCw, Image as ImageIcon, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

interface RegenerateCVModalProps {
  cv: any;
  onClose: () => void;
  onRegenerate: (cvId: string, customBranding?: any) => Promise<void>;
}

export function RegenerateCVModal({ cv, onClose, onRegenerate }: RegenerateCVModalProps) {
  const [branding, setBranding] = useState({
    header_base64: "",
    footer_base64: "",
    header_name: "",
    footer_name: ""
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTenderBranding() {
      try {
        const tender = await api.getTender(cv.tenderId);
        const globalBranding = await api.getGlobalBranding();
        setBranding({
          header_base64: cv.customBranding?.header_base64 || tender?.branding?.header_base64 || globalBranding.header_base64 || '',
          footer_base64: cv.customBranding?.footer_base64 || tender?.branding?.footer_base64 || globalBranding.footer_base64 || '',
          header_name: cv.customBranding?.header_name || tender?.branding?.header_name || globalBranding.header_name || '',
          footer_name: cv.customBranding?.footer_name || tender?.branding?.footer_name || globalBranding.footer_name || ''
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadTenderBranding();
  }, [cv]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'header' | 'footer') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setBranding((prev) => ({
        ...prev,
        [type === 'header' ? 'header_base64' : 'footer_base64']: reader.result as string,
        [type === 'header' ? 'header_name' : 'footer_name']: file.name
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = async () => {
    setIsGenerating(true);
    await onRegenerate(cv.id, branding);
    setIsGenerating(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }} 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
        onClick={onClose} 
      />
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }} 
        animate={{ scale: 1, opacity: 1, y: 0 }} 
        exit={{ scale: 0.95, opacity: 0, y: 20 }} 
        className="relative w-full max-w-xl bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl"
      >
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Regenerate CV</h3>
            <p className="text-sm text-slate-500 font-medium">Uses saved defaults unless you replace them here</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-8 space-y-8">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-blue-500" />
            </div>
          ) : (
            <section className="space-y-4">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-600 block">Custom Header</label>
                  <p className="text-xs text-slate-500">Best fit: 1800 x 250 px</p>
                  <div className="relative aspect-[36/5] bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center overflow-hidden group hover:border-blue-500/50 transition-colors">
                    {branding.header_base64 ? (
                      <img src={branding.header_base64} className="w-full h-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                         <ImageIcon size={20} className="text-slate-400" />
                         <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter text-center">Upload Header</span>
                      </div>
                    )}
                    <label className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity z-10">
                      <span className="text-[10px] font-bold text-white uppercase tracking-widest">Update</span>
                      <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'header')} />
                    </label>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {branding.header_name ? `Using ${branding.header_name}` : 'No saved header'}
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-600 block">Custom Footer</label>
                  <p className="text-xs text-slate-500">Best fit: 1800 x 120 px</p>
                  <div className="relative aspect-[15/1] min-h-[44px] bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center overflow-hidden group hover:border-blue-500/50 transition-colors">
                    {branding.footer_base64 ? (
                      <img src={branding.footer_base64} className="w-full h-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                         <ImageIcon size={20} className="text-slate-400" />
                         <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter text-center">Upload Footer</span>
                      </div>
                    )}
                    <label className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity z-10">
                      <span className="text-[10px] font-bold text-white uppercase tracking-widest">Update</span>
                      <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'footer')} />
                    </label>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {branding.footer_name ? `Using ${branding.footer_name}` : 'No saved footer'}
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end items-center gap-3">
           <button 
             onClick={onClose}
             disabled={isGenerating}
             className="px-6 py-2 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 text-slate-700 text-sm font-medium rounded-xl transition-all"
           >
             Cancel
           </button>
           <button 
             onClick={handleConfirm}
             disabled={isGenerating || loading}
             className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-sm flex items-center gap-2"
           >
             {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
             {isGenerating ? "Regenerating..." : "Regenerate CV"}
           </button>
        </div>
      </motion.div>
    </div>
  );
}
