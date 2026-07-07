import React, { useState } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronUp, Loader2, Languages } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { ALL_PRIMARY_POSITIONS } from '../lib/constants';
import { translateExpertData } from '../lib/gemini';
import { normalizeExpertCollections } from '../lib/cvPostProcess';

interface AddExpertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any; // If provided, we are in Edit mode
}

const Accordion = ({ title, icon, children, defaultOpen = false, count = null }: { title: string, icon?: React.ReactNode, children: React.ReactNode, defaultOpen?: boolean, count?: number | null }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white mb-4 shadow-sm">
      <button 
        type="button" 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-slate-50/[0.3] hover:bg-slate-50 transition-colors text-left"
      >
        <div className="font-semibold text-slate-800 text-sm flex items-center gap-3">
           {icon}
           <span>{title} {count !== null && count !== undefined && `(${count})`}</span>
        </div>
        {isOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>
      {isOpen && (
        <div className="p-6 border-t border-slate-100 bg-white">
          {children}
        </div>
      )}
    </div>
  )
}

const toArray = (value: any): any[] => Array.isArray(value) ? value : value ? [value] : [];
const joinValues = (value: any, mapper?: (item: any) => string) =>
  toArray(value)
    .map((item) => mapper ? mapper(item) : (typeof item === 'string' ? item : item?.name || item?.title || item?.value || ''))
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(', ');
const splitCommaValues = (value: string) => value ? value.split(',').map(item => item.trim()).filter(Boolean) : [];

export default function AddExpertModal({ isOpen, onClose, onSuccess, initialData }: AddExpertModalProps) {
  const normalizedInitialData = initialData ? normalizeExpertCollections(initialData) : undefined;
  const [formData, setFormData] = useState({
    id: normalizedInitialData?.id || '',
    fullName: normalizedInitialData?.fullName || normalizedInitialData?.name || '',
    email: normalizedInitialData?.email || '',
    phone: normalizedInitialData?.phone || '',
    primary_position: normalizedInitialData?.primary_position || '',
    role: normalizedInitialData?.role || '',
    location: normalizedInitialData?.location || '',
    countries: joinValues(normalizedInitialData?.countries),
    educationLevel: normalizedInitialData?.educationLevel || '',
    experienceYears: normalizedInitialData?.experienceYears || '',
    type: normalizedInitialData?.type || 'External',
    skills: joinValues(normalizedInitialData?.skills),
    software: joinValues(normalizedInitialData?.software),
    dateOfBirth: normalizedInitialData?.dateOfBirth || '',
    countryOfCitizenship: normalizedInitialData?.countryOfCitizenship || '',
    profileSummary: normalizedInitialData?.profileSummary || '',
    availability: normalizedInitialData?.availability || '',
    languages: joinValues(normalizedInitialData?.languages),
    certifications: joinValues(normalizedInitialData?.metadata?.certifications, (c: any) => c.title) || joinValues(normalizedInitialData?.certifications)
  });

  const [educations, setEducations] = useState<any[]>(normalizedInitialData?.metadata?.educations || []);
  const [experiences, setExperiences] = useState<any[]>(normalizedInitialData?.experiences || normalizedInitialData?.metadata?.experiences || []);
  const [adequacyAssignments, setAdequacyAssignments] = useState<any[]>(normalizedInitialData?.adequacy_experience || normalizedInitialData?.metadata?.adequacy || []);
  const [projects, setProjects] = useState<any[]>(normalizedInitialData?.projects || []);
  const [unmappedData, setUnmappedData] = useState<any[]>(normalizedInitialData?.metadata?.unmapped_data || []);
  const [trainingCourses, setTrainingCourses] = useState<string>(joinValues(normalizedInitialData?.training_courses || normalizedInitialData?.training));
  const [professionalMembership, setProfessionalMembership] = useState<string>(joinValues(normalizedInitialData?.professionalMembership));
  const [awards, setAwards] = useState<any[]>(normalizedInitialData?.metadata?.awards || []);
  const [publications, setPublications] = useState<any[]>(normalizedInitialData?.metadata?.publications || []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('');
  const [expertTypes, setExpertTypes] = useState<string[]>(['External', 'Internal']);

  React.useEffect(() => {
    api.getLookups()
      .then((lookups) => {
        if (lookups.expertTypes?.length) setExpertTypes(lookups.expertTypes);
      })
      .catch((error) => {
        console.warn('Expert type lookup values could not be loaded:', error);
      });
  }, []);

  React.useEffect(() => {
    if (initialData) {
      const normalized = normalizeExpertCollections(initialData);
      setFormData({
        id: normalized.id || '',
        fullName: normalized.fullName || normalized.name || '',
        email: normalized.email || '',
        phone: normalized.phone || '',
        primary_position: normalized.primary_position || '',
        role: normalized.role || '',
        location: normalized.location || '',
        countries: joinValues(normalized.countries),
        educationLevel: normalized.educationLevel || '',
        experienceYears: normalized.experienceYears || '',
        type: normalized.type || 'External',
        skills: joinValues(normalized.skills),
        software: joinValues(normalized.software),
        dateOfBirth: normalized.dateOfBirth || '',
        countryOfCitizenship: normalized.countryOfCitizenship || '',
        profileSummary: normalized.profileSummary || '',
        availability: normalized.availability || '',
        languages: joinValues(normalized.languages),
        certifications: joinValues(normalized.metadata?.certifications, (c: any) => c.title) || joinValues(normalized.certifications)
      });
      setEducations(normalized.metadata?.educations || []);
      setExperiences(normalized.experiences || normalized.metadata?.experiences || []);
      setAdequacyAssignments(normalized.adequacy_experience || normalized.metadata?.adequacy || []);
      setProjects(normalized.projects || []);
      setUnmappedData(normalized.metadata?.unmapped_data || []);
      setTrainingCourses(joinValues(normalized.training_courses || normalized.training));
      setProfessionalMembership(joinValues(normalized.professionalMembership));
      setAwards(normalized.metadata?.awards || []);
      setPublications(normalized.metadata?.publications || []);
    }
  }, [initialData]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleArrayChange = (setter: any, index: number, field: string, value: string) => {
    setter((prev: any[]) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleTranslate = async () => {
    if (!targetLang) return;
    setIsTranslating(true);
    
    // Simplification for brevity: we are not translating deeper array fields just yet 
    // unless explicitly needed, but we'll try sending formData at least.
    const expertObjectToTranslate = {
      ...formData,
      experiences,
      projects,
      metadata: {
        educations,
        adequacy: adequacyAssignments
      }
    };

    try {
      const translated = await translateExpertData(expertObjectToTranslate, targetLang);
      
      setFormData(prev => ({
        ...prev,
        fullName: translated.fullName || translated.name || prev.fullName,
        primary_position: translated.primary_position || prev.primary_position,
        location: translated.location || prev.location,
        countries: joinValues(translated.countries) || prev.countries,
        educationLevel: translated.educationLevel || prev.educationLevel,
        skills: joinValues(translated.skills) || prev.skills,
        software: joinValues(translated.software) || prev.software,
        countryOfCitizenship: translated.countryOfCitizenship || prev.countryOfCitizenship,
        profileSummary: translated.profileSummary || prev.profileSummary,
        availability: translated.availability || prev.availability
      }));
    } catch (err) {
      console.error(err);
      alert("Translation failed. See console for details.");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    const newExpert = normalizeExpertCollections({
      ...formData,
      primary_position: formData.primary_position || '',
      countries: formData.countries ? formData.countries.split(',').map(c => c.trim()).filter(Boolean) : [],
      skills: formData.skills ? formData.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
      software: formData.software ? formData.software.split(',').map(s => s.trim()).filter(Boolean) : [],
      training_courses: splitCommaValues(trainingCourses),
      professionalMembership: splitCommaValues(professionalMembership),
      experienceYears: parseInt(formData.experienceYears as string) || 0,
      experiences,
      projects,
      adequacy_experience: adequacyAssignments,
      metadata: {
        educations,
        languages: formData.languages ? formData.languages.split(',').map(l => ({ name: l.trim() })).filter(l => l.name) : [],
        certifications: formData.certifications ? formData.certifications.split(',').map(c => ({ title: c.trim() })).filter(c => c.title) : [],
        awards,
        publications,
        adequacy: adequacyAssignments,
        unmapped_data: unmappedData
      }
    });

    try {
      if (initialData?.id) {
        await api.updateExpert(initialData.id, newExpert);
      } else {
        await api.saveExperts([newExpert]);
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Error saving expert:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-center bg-slate-900/40 backdrop-blur-[2px] p-4 sm:p-6">
      <div className="w-full max-w-4xl h-[90vh] bg-slate-50 flex flex-col rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{initialData ? 'Edit Expert' : 'Add Expert'}</h2>
            {initialData?.original_cv_filename && initialData?.original_cv_url && (
              <a href={initialData.original_cv_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 mt-1">
                View Original Document ({initialData.original_cv_filename})
              </a>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto outline-none p-6 space-y-4">
          <form id="add-expert-form" onSubmit={handleSubmit}>
            
            {/* Basic Information */}
            <Accordion title="Basic Information" icon={<span className="text-xl">📄</span>} defaultOpen>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Full Name *</label>
                  <input required name="fullName" value={formData.fullName} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Role *</label>
                  <input required name="primary_position" value={formData.primary_position} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" placeholder="e.g. Resident Engineer" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Email</label>
                  <input name="email" value={formData.email} onChange={handleChange} type="email" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Phone</label>
                  <input name="phone" value={formData.phone} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Location</label>
                  <input name="location" value={formData.location} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Countries (comma-separated)</label>
                  <input name="countries" value={formData.countries} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Date of Birth</label>
                  <input name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} type="date" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Citizenship</label>
                  <input name="countryOfCitizenship" value={formData.countryOfCitizenship} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Availability</label>
                  <input name="availability" value={formData.availability} onChange={handleChange} type="text" placeholder="e.g. Available immediately, 2 weeks notice" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Profile Summary</label>
                  <textarea name="profileSummary" value={formData.profileSummary} onChange={handleChange} rows={3} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none shadow-sm"></textarea>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Type *</label>
                  <select name="type" value={formData.type} onChange={handleChange} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white shadow-sm">
                    {expertTypes.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
              </div>
            </Accordion>

            {/* Education Level & Experience */}
            <Accordion title="Education Level & Experience" icon={<span className="text-xl">🎓</span>}>
              <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Education Level</label>
                  <input name="educationLevel" value={formData.educationLevel} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Years of Experience</label>
                  <input name="experienceYears" value={formData.experienceYears} onChange={handleChange} type="number" min="0" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Languages (comma-separated)</label>
                  <input name="languages" value={formData.languages} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
              </div>
            </Accordion>

            {/* Skills & Certifications */}
            <Accordion title="Skills & Certifications" icon={<span className="text-xl">🛠️</span>}>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Skills (comma-separated)</label>
                  <input name="skills" value={formData.skills} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Software (comma-separated)</label>
                  <input name="software" value={formData.software} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Certifications (comma-separated)</label>
                  <input name="certifications" value={formData.certifications} onChange={handleChange} type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                </div>
              </div>
            </Accordion>

            {/* Professional Extras */}
            <Accordion title="Professional Extras" count={splitCommaValues(trainingCourses).length + splitCommaValues(professionalMembership).length + awards.length + publications.length} icon={<span className="text-xl">★</span>}>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Training Courses (comma-separated)</label>
                    <textarea value={trainingCourses} onChange={(e) => setTrainingCourses(e.target.value)} rows={3} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Professional Memberships (comma-separated)</label>
                    <textarea value={professionalMembership} onChange={(e) => setProfessionalMembership(e.target.value)} rows={3} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm" />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Awards ({awards.length})</h4>
                    <button type="button" onClick={() => setAwards(prev => [...prev, {}])} className="text-xs font-semibold text-blue-700 hover:text-blue-900 flex items-center gap-1">
                      <Plus size={14} /> Add Award
                    </button>
                  </div>
                  {awards.map((award, idx) => (
                    <div key={idx} className="p-4 border border-slate-200 rounded-lg bg-white shadow-sm">
                      <div className="flex justify-between mb-3 border-b border-slate-100 pb-2">
                        <span className="font-semibold text-sm text-slate-700">Award {idx + 1}</span>
                        <button type="button" onClick={() => setAwards(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 opacity-60 hover:opacity-100 p-1">
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <input type="text" value={award.title || ''} onChange={(e) => handleArrayChange(setAwards, idx, 'title', e.target.value)} placeholder="Title" className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                        <input type="text" value={award.issuer || ''} onChange={(e) => handleArrayChange(setAwards, idx, 'issuer', e.target.value)} placeholder="Issuer" className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                        <input type="text" value={award.country || ''} onChange={(e) => handleArrayChange(setAwards, idx, 'country', e.target.value)} placeholder="Country" className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                        <input type="text" value={award.year || ''} onChange={(e) => handleArrayChange(setAwards, idx, 'year', e.target.value)} placeholder="Year" className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                        <textarea value={award.description || ''} onChange={(e) => handleArrayChange(setAwards, idx, 'description', e.target.value)} placeholder="Description" rows={2} className="col-span-2 w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Publications ({publications.length})</h4>
                    <button type="button" onClick={() => setPublications(prev => [...prev, {}])} className="text-xs font-semibold text-blue-700 hover:text-blue-900 flex items-center gap-1">
                      <Plus size={14} /> Add Publication
                    </button>
                  </div>
                  {publications.map((publication, idx) => (
                    <div key={idx} className="p-4 border border-slate-200 rounded-lg bg-white shadow-sm">
                      <div className="flex justify-between mb-3 border-b border-slate-100 pb-2">
                        <span className="font-semibold text-sm text-slate-700">Publication {idx + 1}</span>
                        <button type="button" onClick={() => setPublications(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 opacity-60 hover:opacity-100 p-1">
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <input type="text" value={publication.title || ''} onChange={(e) => handleArrayChange(setPublications, idx, 'title', e.target.value)} placeholder="Title" className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                        <input type="text" value={publication.journal || ''} onChange={(e) => handleArrayChange(setPublications, idx, 'journal', e.target.value)} placeholder="Journal / Publisher" className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                        <input type="text" value={publication.year || ''} onChange={(e) => handleArrayChange(setPublications, idx, 'year', e.target.value)} placeholder="Year" className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                        <textarea value={publication.description || ''} onChange={(e) => handleArrayChange(setPublications, idx, 'description', e.target.value)} placeholder="Description" rows={2} className="col-span-2 w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Accordion>

            {/* Education Details Array */}
            <Accordion title="Education Details" count={educations.length} icon={<span className="text-xl">🎓</span>}>
              <div className="space-y-4">
                {educations.map((edu, idx) => (
                  <div key={idx} className="p-4 border border-slate-200 rounded-lg relative bg-white shadow-sm">
                    <div className="flex justify-between mb-3 border-b border-slate-100 pb-2">
                      <span className="font-semibold text-sm text-slate-700">Education {idx + 1}</span>
                      <button type="button" onClick={() => setEducations(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 opacity-60 hover:opacity-100 p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Degree</label>
                        <input type="text" value={edu.degree || ''} onChange={(e) => handleArrayChange(setEducations, idx, 'degree', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Field of Study</label>
                        <input type="text" value={edu.field || ''} onChange={(e) => handleArrayChange(setEducations, idx, 'field', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Institution</label>
                        <input type="text" value={edu.institution || ''} onChange={(e) => handleArrayChange(setEducations, idx, 'institution', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Year</label>
                        <input type="text" value={edu.year || ''} onChange={(e) => handleArrayChange(setEducations, idx, 'year', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Location</label>
                        <input type="text" value={edu.location || ''} onChange={(e) => handleArrayChange(setEducations, idx, 'location', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Grade/GPA</label>
                        <input type="text" value={edu.grade || ''} onChange={(e) => handleArrayChange(setEducations, idx, 'grade', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" placeholder="e.g. 3.8 GPA" />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs font-semibold text-slate-600">Notes</label>
                        <textarea value={edu.notes || ''} onChange={(e) => handleArrayChange(setEducations, idx, 'notes', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" rows={2}></textarea>
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setEducations(prev => [...prev, {}])} className="w-full py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg flex items-center justify-center gap-2 border border-dashed border-slate-300 transition-colors">
                  <Plus size={16} /> Add Education
                </button>
              </div>
            </Accordion>

            {/* Work Experience */}
            <Accordion title="Work Experience" count={experiences.length} icon={<span className="text-xl">💼</span>}>
              <div className="space-y-4">
                {experiences.map((exp, idx) => (
                  <div key={idx} className="p-4 border border-slate-200 rounded-lg relative bg-white shadow-sm">
                    <div className="flex justify-between mb-3 border-b border-slate-100 pb-2">
                      <span className="font-semibold text-sm text-slate-700">Experience {idx + 1}</span>
                      <button type="button" onClick={() => setExperiences(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 opacity-60 hover:opacity-100 p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Company</label>
                        <input type="text" value={exp.company || exp.organization || ''} onChange={(e) => handleArrayChange(setExperiences, idx, 'organization', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Position</label>
                        <input type="text" value={exp.position || exp.role || ''} onChange={(e) => handleArrayChange(setExperiences, idx, 'role', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Duration</label>
                        <input type="text" value={exp.duration || (exp.start_date ? `${exp.start_date}${exp.end_date ? ' - ' + exp.end_date : ''}` : '')} onChange={(e) => handleArrayChange(setExperiences, idx, 'duration', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" placeholder="e.g. Sep 2021 - Jun 2024" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Country</label>
                        <input type="text" value={exp.country || ''} onChange={(e) => handleArrayChange(setExperiences, idx, 'country', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs font-semibold text-slate-600">Description</label>
                        <textarea value={exp.description || ''} onChange={(e) => handleArrayChange(setExperiences, idx, 'description', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" rows={4}></textarea>
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setExperiences(prev => [...prev, {}])} className="w-full py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg flex items-center justify-center gap-2 border border-dashed border-slate-300 transition-colors">
                  <Plus size={16} /> Add Experience
                </button>
              </div>
            </Accordion>

            {/* Adequacy Assignments */}
            <Accordion title="Adequacy Assignments" count={adequacyAssignments.length} icon={<span className="text-xl">📋</span>}>
              <div className="space-y-4">
                {adequacyAssignments.map((assig, idx) => (
                  <div key={idx} className="p-4 border border-slate-200 rounded-lg relative bg-white shadow-sm">
                    <div className="flex justify-between mb-3 border-b border-slate-100 pb-2">
                      <span className="font-semibold text-sm text-slate-700">Assignment {idx + 1}</span>
                      <button type="button" onClick={() => setAdequacyAssignments(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 opacity-60 hover:opacity-100 p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Period</label>
                        <input type="text" value={assig.period || ''} onChange={(e) => handleArrayChange(setAdequacyAssignments, idx, 'period', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Country</label>
                        <input type="text" value={assig.country || ''} onChange={(e) => handleArrayChange(setAdequacyAssignments, idx, 'country', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Position</label>
                        <input type="text" value={assig.position || ''} onChange={(e) => handleArrayChange(setAdequacyAssignments, idx, 'position', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Client</label>
                        <input type="text" value={assig.client || ''} onChange={(e) => handleArrayChange(setAdequacyAssignments, idx, 'client', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs font-semibold text-slate-600">Category</label>
                        <input type="text" value={assig.category || ''} onChange={(e) => handleArrayChange(setAdequacyAssignments, idx, 'category', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs font-semibold text-slate-600">Assignment Description</label>
                        <textarea value={assig.assignmentDescription || assig.assignment || ''} onChange={(e) => handleArrayChange(setAdequacyAssignments, idx, 'assignment', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" rows={4}></textarea>
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setAdequacyAssignments(prev => [...prev, {}])} className="w-full py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg flex items-center justify-center gap-2 border border-dashed border-slate-300 transition-colors">
                  <Plus size={16} /> Add Assignment
                </button>
              </div>
            </Accordion>

            {/* Unmapped Data (Other relevant text) */}
            <Accordion title="Additional Information" count={unmappedData.length} icon={<span className="text-xl">ℹ️</span>}>
              <div className="space-y-4">
                {unmappedData.map((data, idx) => (
                  <div key={idx} className="p-4 border border-slate-200 rounded-lg relative bg-white shadow-sm">
                    <div className="flex justify-between mb-3 border-b border-slate-100 pb-2">
                      <span className="font-semibold text-sm text-slate-700">Data Point {idx + 1}</span>
                      <button type="button" onClick={() => setUnmappedData(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 opacity-60 hover:opacity-100 p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Key (Category)</label>
                        <input type="text" value={data.key || ''} onChange={(e) => handleArrayChange(setUnmappedData, idx, 'key', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" placeholder="e.g. Key Qualifications" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Value (Details)</label>
                        <textarea value={data.value || ''} onChange={(e) => handleArrayChange(setUnmappedData, idx, 'value', e.target.value)} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm shadow-sm" rows={3}></textarea>
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setUnmappedData(prev => [...prev, {}])} className="w-full py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg flex items-center justify-center gap-2 border border-dashed border-slate-300 transition-colors">
                  <Plus size={16} /> Add Information
                </button>
              </div>
            </Accordion>

          </form>
        </div>

        <div className="border-t border-slate-200 p-6 bg-white flex items-center justify-between gap-3 shrink-0 rounded-b-xl shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
          <div>
            {initialData?.original_cv_text && (
              <button
                type="button"
                className="px-4 py-2.5 bg-sky-100 hover:bg-sky-200 text-sky-800 border border-sky-300 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
                disabled={isSubmitting || isTranslating}
                onClick={async () => {
                  try {
                    setIsSubmitting(true);
                    const { parseCVText } = await import('../lib/gemini');
                    const parsedChunks = await parseCVText(`--- RE-ANALYSIS DOC ---\n${initialData.original_cv_text}`);
                    if (parsedChunks && parsedChunks.length > 0) {
                      const rep = parsedChunks[0];
                      // merge new parsed data into current form
                      setFormData(prev => ({
                        ...prev, ...rep, id: prev.id, original_cv_text: initialData.original_cv_text, original_cv_url: initialData.original_cv_url, original_cv_filename: initialData.original_cv_filename,
                        languages: joinValues(rep.metadata?.languages, (l: any) => l.name) || joinValues(rep.languages) || prev.languages,
                        certifications: joinValues(rep.metadata?.certifications, (c: any) => c.title) || joinValues(rep.certifications) || prev.certifications,
                        skills: joinValues(rep.skills) || prev.skills,
                        software: joinValues(rep.software) || prev.software,
                        countries: joinValues(rep.countries) || prev.countries,
                      }));
                      setEducations(rep.metadata?.educations || rep.education || []);
                      setExperiences(rep.experiences || rep.employment_history || []);
                      setProjects(rep.projects || []);
                      setAdequacyAssignments(rep.adequacy_experience || rep.metadata?.adequacy || []);
                      setUnmappedData(rep.metadata?.unmapped_data || []);
                      setTrainingCourses(joinValues(rep.training_courses || rep.training));
                      setProfessionalMembership(joinValues(rep.professionalMembership));
                      setAwards(rep.metadata?.awards || []);
                      setPublications(rep.metadata?.publications || []);
                      alert("Successfully re-analyzed document. Review the changes before clicking Update Expert.");
                    }
                  } catch (e: any) {
                    alert("Re-analyze failed: " + e.message);
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
              >
                <Loader2 className={clsx("w-4 h-4", isSubmitting && "animate-spin")} />
                Re-Analyze Document
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-200 transition-colors">
              Cancel
            </button>
            <button 
              type="submit" 
              form="add-expert-form"
              disabled={isSubmitting || isTranslating}
              className={clsx("px-5 py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm", (isSubmitting || isTranslating) && "opacity-50")}
            >
              {isSubmitting ? "Processing..." : (initialData ? "Update Expert" : "Save Expert")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
