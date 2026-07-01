import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../lib/api';

interface EditTenderModalProps {
  isOpen: boolean;
  onClose: () => void;
  tender: any;
  onSave: () => void;
}

export function EditTenderModal({ isOpen, onClose, tender, onSave }: EditTenderModalProps) {
  const [formData, setFormData] = useState({
    internal_code: '',
    name: '',
    tender_title: '',
    client: '',
    tender_format: '',
    status: '',
    deadline: ''
  });

  useEffect(() => {
    if (tender) {
      setFormData({
        internal_code: tender.internal_code || '',
        name: tender.name || '',
        tender_title: tender.tender_title || '',
        client: tender.client || '',
        tender_format: tender.tender_format || '',
        status: tender.status || '',
        deadline: tender.deadline || ''
      });
    }
  }, [tender]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (!tender) return;
    try {
      await api.updateTender(tender.id, {
        internal_code: formData.internal_code,
        name: formData.name,
        tender_title: formData.tender_title || formData.name,
        client: formData.client,
        tender_format: formData.tender_format,
        status: formData.status,
        deadline: formData.deadline
      });
      onSave();
      onClose();
    } catch (error) {
      console.error(error);
      alert('Failed to update tender settings');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-xl shadow-xl z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Edit Tender</h2>
                <p className="text-sm text-slate-500">Update table details</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Internal Code</label>
                <input
                  type="text"
                  name="internal_code"
                  value={formData.internal_code}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. TND-2024-01"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tender Name / Details</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Client</label>
                <input
                  type="text"
                  name="client"
                  value={formData.client}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type / Format</label>
                <input
                  type="text"
                  name="tender_format"
                  value={formData.tender_format}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Deadline</label>
                <input
                  type="date"
                  name="deadline"
                  value={formData.deadline}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select Status...</option>
                  <option value="New">New</option>
                  <option value="Tender Extraction Completed">Tender Extraction Completed</option>
                  <option value="Matching Completed">Matching Completed</option>
                  <option value="Review">Review</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>

            </div>

            <div className="p-4 sm:p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 bg-slate-200/50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Save Details
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
