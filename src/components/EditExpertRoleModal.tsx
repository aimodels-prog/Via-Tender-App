import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Save, ShieldAlert } from 'lucide-react';

interface EditExpertRoleModalProps {
  expert: any;
  taxonomy: string[];
  onSave: (expertId: string, primaryPosition: string) => Promise<void>;
  onClose: () => void;
}

export function EditExpertRoleModal({ expert, taxonomy, onSave, onClose }: EditExpertRoleModalProps) {
  const [selectedRole, setSelectedRole] = useState(expert.role || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(expert.id, selectedRole);
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Edit Folder Name</h2>
            <p className="text-sm text-slate-500 mt-1">Classify {expert.fullName || expert.name} for accurate matching</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3 text-blue-700">
            <ShieldAlert size={20} className="shrink-0" />
            <p className="text-sm">
              The Folder acts as the <strong>Stage 1 Strict Filter</strong> during Match Engine operations. Ensure it correctly maps to our standard folders.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Folder Selection</label>
            <select 
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 font-medium focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">-- Select a Folder --</option>
              {taxonomy.map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
              <option value="Others">Others</option>
            </select>
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving || !selectedRole}
            className="px-5 py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? "Saving..." : "Save Classification"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
