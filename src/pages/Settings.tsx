import React, { useState, useEffect } from 'react';
import { 
  User,
  Users,
  ShieldCheck,
  Globe,
  Plus,
  XCircle,
  Cloud,
  CheckCircle2,
  RefreshCw,
  Save,
  Folder,
  LayoutDashboard,
  Image as ImageIcon,
  Trash2
} from 'lucide-react';
import { api } from '../lib/api';
import { ALL_PRIMARY_POSITIONS } from '../lib/constants';
import UsersComponent from './Users';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { scanGoogleDriveNow } from '../lib/googleDriveSync';
import { useTasks } from '../lib/TasksContext';

export default function Settings() {
  const { isAdmin, currentUser, refreshUser } = useAuth();
  const { addTask, updateTask } = useTasks();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'profile');
  const [driveSettings, setDriveSettings] = useState({
    cvFolderId: '',
    apiKeyConfigured: false,
    serviceAccountConfigured: false,
    scanIntervalMinutes: 5,
    autoScanEnabled: false
  });
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [isScanningDrive, setIsScanningDrive] = useState(false);
  const [driveScanMessage, setDriveScanMessage] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [taxonomy, setTaxonomy] = useState<string[]>([]);
  const [newTaxonomy, setNewTaxonomy] = useState('');
  const [globalBranding, setGlobalBranding] = useState({
    header_base64: '',
    footer_base64: '',
    header_name: '',
    footer_name: ''
  });
  
  const [profile, setProfile] = useState({
    fullName: 'Admin User',
    email: 'admin@via-international.com',
    organization: 'Tender & Bidding Operations',
    avatar: ''
  });
  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: ''
  });
  const [hiddenModules, setHiddenModules] = useState<string[]>(['matches', 'generated-cvs']);

  useEffect(() => {
    async function load() {
      const config = await api.getGoogleDriveSettings();
      if (config) {
        setDriveSettings({
          cvFolderId: config.cvFolderId || config.folderId || '',
          apiKeyConfigured: Boolean(config.apiKeyConfigured),
          serviceAccountConfigured: Boolean(config.serviceAccountConfigured),
          scanIntervalMinutes: Number(config.scanIntervalMinutes || 5),
          autoScanEnabled: Boolean(config.autoScanEnabled)
        });
      }
      setDriveFiles(await api.getDriveFiles());
      const tax = await api.getTaxonomy();
      setTaxonomy(tax || ALL_PRIMARY_POSITIONS);
      const branding = await api.getGlobalBranding();
      setGlobalBranding({
        header_base64: branding.header_base64 || '',
        footer_base64: branding.footer_base64 || '',
        header_name: branding.header_name || '',
        footer_name: branding.footer_name || ''
      });

      setLoading(false);
      
      const hm = localStorage.getItem('hidden_modules_prefs');
      if (hm) setHiddenModules(JSON.parse(hm));
    }
    load();
  }, []);

  useEffect(() => {
    if (currentUser) {
      setProfile((prev) => ({
        ...prev,
        fullName: currentUser.name,
        email: currentUser.email,
      }));
    }
  }, [currentUser]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) {
      setActiveTab(!isAdmin && isAdminOnlyTab(tab) ? 'profile' : tab);
    }
  }, [searchParams, isAdmin]);

  useEffect(() => {
    if (!isAdmin && isAdminOnlyTab(activeTab)) {
      setActiveTab('profile');
    }
  }, [activeTab, isAdmin]);

  const isAdminOnlyTab = (tab: string) => ['taxonomy', 'branding', 'users', 'integrations', 'modules'].includes(tab);

  const handleTabChange = (tab: string) => {
     if (!isAdmin && isAdminOnlyTab(tab)) return;
     setActiveTab(tab);
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    const config = await api.getGoogleDriveSettings();
    const newConfig = {
      ...driveSettings,
      apiKeyConfigured: config.apiKeyConfigured,
      serviceAccountConfigured: config.serviceAccountConfigured,
      scanIntervalMinutes: Number(driveSettings.scanIntervalMinutes || 5),
    };
    await api.saveGoogleDriveSettings(newConfig);
    
    await api.saveTaxonomy(taxonomy);
    
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const updateDriveSetting = (key: keyof typeof driveSettings, value: string | number | boolean) => {
    setDriveSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleScanDrive = async () => {
    if (!isAdmin || isScanningDrive) return;
    setIsScanningDrive(true);
    setDriveScanMessage('');
    try {
      await handleSave();
      const result = await scanGoogleDriveNow(addTask, updateTask);
      setDriveFiles(await api.getDriveFiles());
      setDriveScanMessage(`Scan complete. Ready for review ${result.imported}, failed ${result.failed}, scanned ${result.scanned}.`);
    } catch (error: any) {
      setDriveScanMessage(error.message || 'Google Drive scan failed.');
    } finally {
      setIsScanningDrive(false);
    }
  };

  const handleBrandingUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'header' | 'footer') => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setGlobalBranding(prev => ({
        ...prev,
        [type === 'header' ? 'header_base64' : 'footer_base64']: reader.result as string,
        [type === 'header' ? 'header_name' : 'footer_name']: file.name
      }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const clearBrandingAsset = (type: 'header' | 'footer') => {
    if (!isAdmin) return;
    setGlobalBranding(prev => ({
      ...prev,
      [type === 'header' ? 'header_base64' : 'footer_base64']: '',
      [type === 'header' ? 'header_name' : 'footer_name']: ''
    }));
  };

  const handleSaveBranding = async () => {
    if (!isAdmin) return;
    await api.saveGlobalBranding(globalBranding);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleAddTaxonomy = () => {
    if (!isAdmin) return;
    if (newTaxonomy.trim() && !taxonomy.includes(newTaxonomy.trim())) {
      setTaxonomy([...taxonomy, newTaxonomy.trim()]);
      setNewTaxonomy('');
    }
  };

  const removeTaxonomy = (index: number) => {
    if (!isAdmin) return;
    setTaxonomy(taxonomy.filter((_, i) => i !== index));
  };

  const handleSaveProfile = async () => {
    if (currentUser) {
      await api.updateUser(currentUser.id, {
        name: profile.fullName,
        email: profile.email,
      });
      await refreshUser();
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleSaveSecurity = async () => {
    if (passwords.new && passwords.new !== passwords.confirm) {
      alert("New passwords do not match!");
      return;
    }
    if (currentUser && passwords.new) {
      await api.updateUser(currentUser.id, { password: passwords.new });
      await refreshUser();
    }
    setPasswords({ current: '', new: '', confirm: '' });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const toggleModule = (moduleName: string) => {
    const next = hiddenModules.includes(moduleName)
      ? hiddenModules.filter(m => m !== moduleName)
      : [...hiddenModules, moduleName];
      
    setHiddenModules(next);
    localStorage.setItem('hidden_modules_prefs', JSON.stringify(next));
    window.dispatchEvent(new Event('settingsUpdated'));
  };

  return (
    <div className="space-y-6 max-w-full w-full mx-auto pb-32">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
        <p className="text-sm text-slate-500 mt-1">Manage your account and system preferences</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 mt-8">
        {/* Sidebar */}
        <div className="w-full md:w-64 shrink-0">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">Settings</h3>
            </div>
            <div className="p-2 space-y-1">
              <button 
                onClick={() => setActiveTab('profile')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'profile' 
                    ? 'bg-blue-50 text-blue-600' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <User size={16} />
                Profile
              </button>
              <button 
                onClick={() => setActiveTab('security')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'security' 
                    ? 'bg-blue-50 text-blue-600' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <ShieldCheck size={16} />
                Security
              </button>
              <button 
                onClick={() => setActiveTab('taxonomy')}
                hidden={!isAdmin}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'taxonomy' 
                    ? 'bg-blue-50 text-blue-600' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Folder size={16} />
                Taxonomy
              </button>
              <button 
                onClick={() => setActiveTab('branding')}
                hidden={!isAdmin}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'branding' 
                    ? 'bg-blue-50 text-blue-600' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <ImageIcon size={16} />
                Branding
              </button>
              <button 
                onClick={() => setActiveTab('users')}
                hidden={!isAdmin}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'users' 
                    ? 'bg-blue-50 text-blue-600' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Users size={16} />
                Users
              </button>
              <button 
                onClick={() => setActiveTab('integrations')}
                hidden={!isAdmin}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'integrations' 
                    ? 'bg-blue-50 text-blue-600' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Globe size={16} />
                Integrations
              </button>
              <button 
                onClick={() => setActiveTab('modules')}
                hidden={!isAdmin}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'modules' 
                    ? 'bg-blue-50 text-blue-600' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <LayoutDashboard size={16} />
                Modules
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          {activeTab === 'modules' && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Feature Modules</h3>
                  <p className="text-sm text-slate-500 mt-1">Control which application modules are visible and accessible.</p>
                </div>
              </div>
              
              <div className="space-y-4">
                {[
                  { id: 'experts', name: 'Experts', desc: 'Manage your expert database' },
                  { id: 'tenders', name: 'Tenders', desc: 'Manage your tenders and requirements' },
                  { id: 'matches', name: 'Matching Engine', desc: 'Perform AI-based candidate matching against tenders' },
                  { id: 'generated-cvs', name: 'Generate CV', desc: 'Generate and automate CV formatting for matching' }
                ].map(module => {
                  const isVisible = !hiddenModules.includes(module.id);
                  return (
                    <div key={module.id} className="flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{module.name}</p>
                        <p className="text-sm text-slate-500">{module.desc}</p>
                      </div>
                      <button
                        onClick={() => toggleModule(module.id)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isVisible ? 'bg-blue-600' : 'bg-slate-300'}`}
                      >
                        <span className="sr-only">Toggle {module.name}</span>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isVisible ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 overflow-hidden">
               <UsersComponent />
            </div>
          )}

          {activeTab === 'branding' && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Document Branding</h3>
                  <p className="text-sm text-slate-500 mt-1">Set the default header and footer used in generated PDF and Word CVs.</p>
                </div>
                <button 
                  onClick={handleSaveBranding}
                  className="flex items-center gap-2 px-4 py-2 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                  {isSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                  {isSaved ? 'Saved' : 'Save Branding'}
                </button>
              </div>

              {!loading && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {[
                    { type: 'header' as const, label: 'Default Header', size: 'Best fit: 1800 x 250 px', name: globalBranding.header_name, image: globalBranding.header_base64 },
                    { type: 'footer' as const, label: 'Default Footer', size: 'Best fit: 1800 x 120 px', name: globalBranding.footer_name, image: globalBranding.footer_base64 }
                  ].map(asset => (
                    <div key={asset.type} className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{asset.label}</label>
                          <p className="text-xs text-slate-500 mt-0.5">{asset.size}</p>
                        </div>
                        {asset.name && (
                          <button
                            onClick={() => clearBrandingAsset(asset.type)}
                            className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1"
                          >
                            <Trash2 size={13} />
                            Remove
                          </button>
                        )}
                      </div>
                      <div className={`relative ${asset.type === 'header' ? 'aspect-[36/5]' : 'aspect-[15/1] min-h-[48px]'} bg-slate-50 border-2 border-slate-300 border-dashed rounded-lg flex items-center justify-center overflow-hidden group hover:border-blue-500 transition-colors`}>
                        {asset.image ? (
                          <img src={asset.image} className="w-full h-full object-contain" alt={`${asset.label} preview`} />
                        ) : (
                          <div className="flex flex-col items-center gap-1.5">
                            <ImageIcon size={24} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                            <span className="text-xs font-medium text-slate-500 group-hover:text-blue-600 transition-colors text-center">Upload {asset.type}<br/>image</span>
                          </div>
                        )}
                        <label className="absolute inset-0 bg-white/70 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity z-10 font-semibold text-blue-600 text-sm backdrop-blur-[1px]">
                          {asset.image ? 'Replace Image' : 'Upload Image'}
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => handleBrandingUpload(e, asset.type)} />
                        </label>
                      </div>
                      <div className="min-h-5 text-sm text-slate-600">
                        {asset.name ? (
                          <span className="font-medium text-slate-800">{asset.name}</span>
                        ) : (
                          <span>No {asset.type} uploaded</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Google Drive Integration</h3>
                  <p className="text-sm text-slate-500 mt-1">Scan selected Workspace folders for CV files and import them into the expert database.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button 
                    onClick={handleScanDrive}
                    disabled={isScanningDrive}
                    className="flex items-center gap-2 px-4 py-2 bg-[#004b87] hover:bg-blue-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                  >
                    {isScanningDrive ? <RefreshCw size={16} className="animate-spin" /> : <Cloud size={16} />}
                    {isScanningDrive ? 'Scanning...' : 'Scan Now'}
                  </button>
                  <button 
                    onClick={handleSave}
                    className="flex items-center gap-2 px-4 py-2 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                  >
                    {isSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                    {isSaved ? 'Saved' : 'Save Configuration'}
                  </button>
                </div>
              </div>

              {!loading && (
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,0.85fr)_minmax(420px,1.15fr)] gap-6 items-start">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">CV Folder ID</label>
                      <input 
                        type="text" 
                        value={driveSettings.cvFolderId}
                        onChange={(e) => updateDriveSetting('cvFolderId', e.target.value)}
                        placeholder="Paste Google Drive CV folder ID"
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                      <p className="text-xs text-slate-500 mt-1.5">
                        Required. The app scans this folder for new PDF/DOCX CV files.
                      </p>
                    </div>
                    <div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">Server Drive credentials</h4>
                            <p className="text-xs text-slate-500 mt-1">
                              Credentials are configured on the server, not saved in the browser.
                            </p>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                            driveSettings.serviceAccountConfigured || driveSettings.apiKeyConfigured
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            <CheckCircle2 size={14} />
                            {driveSettings.serviceAccountConfigured || driveSettings.apiKeyConfigured ? 'Configured' : 'Not configured'}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Scan Interval Minutes</label>
                          <input 
                            type="number" 
                            min={1}
                            value={driveSettings.scanIntervalMinutes}
                            onChange={(e) => updateDriveSetting('scanIntervalMinutes', Number(e.target.value || 5))}
                            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                          />
                        </div>
                        <label className="flex items-end gap-3 text-sm font-medium text-slate-700 pb-2">
                          <input 
                            type="checkbox"
                            checked={driveSettings.autoScanEnabled}
                            onChange={(e) => updateDriveSetting('autoScanEnabled', e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                          Enable background auto scan
                        </label>
                      </div>
                      {driveScanMessage && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800 mt-4">
                          {driveScanMessage}
                        </div>
                      )}
                      <div className="mt-2 text-sm">
                        <details className="group border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                          <summary className="cursor-pointer px-4 py-2 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors list-none flex justify-between items-center">
                            How to connect Google Drive
                            <span className="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
                          </summary>
                          <div className="p-4 space-y-4 text-slate-600 text-xs">
                            <div>
                              <h4 className="font-bold text-slate-800 mb-1">Recommended setup</h4>
                              <ol className="list-decimal list-inside space-y-1 ml-1">
                                <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google Cloud Console</a> &gt; Credentials.</li>
                                <li>Click <strong>Create Credentials</strong> &gt; <strong>Service Account</strong>.</li>
                                <li>Go to the new Service Account &gt; <strong>Keys</strong> tab &gt; <strong>Add Key</strong> &gt; <strong>JSON</strong>.</li>
                                <li>Save the JSON content as the server environment variable <strong>GOOGLE_SERVICE_ACCOUNT_JSON</strong>.</li>
                                <li>Share the CV folder with the service account email, then paste only the folder ID above.</li>
                              </ol>
                            </div>
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold text-slate-900">Google Drive Import History</h4>
                          <p className="text-xs text-slate-500 mt-0.5">Stored directly in the PostgreSQL drive_files table.</p>
                        </div>
                        <button onClick={async () => setDriveFiles(await api.getDriveFiles())} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                          Refresh
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left">
                          <thead className="bg-white border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">File</th>
                              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</th>
                              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expert</th>
                              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confidence</th>
                              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Updated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {driveFiles.slice(0, 10).map(file => (
                              <tr key={file.id || file.googleFileId} className="border-b border-slate-100">
                                <td className="px-4 py-3">
                                  <p className="text-sm font-semibold text-slate-800">{file.name}</p>
                                  {file.errorMessage && <p className="text-xs text-red-600 mt-1">{file.errorMessage}</p>}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
                                    file.status === 'processed' ? 'bg-green-100 text-green-700' :
                                    file.status === 'failed' ? 'bg-red-100 text-red-700' :
                                    'bg-amber-100 text-amber-700'
                                  }`}>
                                    {file.status || 'new'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-600">{file.expertName || '-'}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{file.confidenceScore ? `${file.confidenceScore}%` : '-'}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{file.updatedAt ? new Date(file.updatedAt).toLocaleString() : '-'}</td>
                              </tr>
                            ))}
                            {!driveFiles.length && (
                              <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                                  No Google Drive files scanned yet.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'taxonomy' && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Taxonomy Management</h3>
                  <p className="text-sm text-slate-500 mt-1">Configure global standard disciplines mapped during AI processing</p>
                </div>
                <button 
                  onClick={handleSave}
                  className="flex items-center gap-2 px-4 py-2 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                  {isSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                  {isSaved ? 'Saved' : 'Save Configuration'}
                </button>
              </div>

              {!loading && (
                <div className="max-w-3xl space-y-6">
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center gap-4">
                     <input 
                       type="text"
                       value={newTaxonomy}
                       onChange={e => setNewTaxonomy(e.target.value)}
                       onKeyDown={e => e.key === 'Enter' && handleAddTaxonomy()}
                       placeholder="Add new primary position format..."
                       className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                     />
                     <button onClick={handleAddTaxonomy} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors flex items-center gap-2">
                        <Plus size={16} /> Add Position
                     </button>
                  </div>

                  <div className="flex flex-wrap gap-3">
                     {taxonomy.map((tax, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-white border border-slate-200 shadow-sm px-4 py-2.5 rounded-lg group">
                           <span className="text-sm font-semibold text-slate-700 uppercase tracking-tight">{tax}</span>
                           <button onClick={() => removeTaxonomy(idx)} className="text-slate-400 hover:text-red-500 transition-colors ml-2">
                              <XCircle size={16} />
                           </button>
                        </div>
                     ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Profile Settings</h3>
                  <p className="text-sm text-slate-500 mt-1">Manage your professional information and preferences</p>
                </div>
                <button 
                  onClick={handleSaveProfile}
                  className="flex items-center gap-2 px-4 py-2 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                  {isSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                  {isSaved ? 'Saved' : 'Save Profile'}
                </button>
              </div>
              <div className="max-w-2xl space-y-6">
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 text-2xl font-bold uppercase overflow-hidden">
                    {profile.avatar ? (
                      <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      profile.fullName.substring(0, 2) || 'UN'
                    )}
                  </div>
                  <label className="cursor-pointer px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm">
                    Change Avatar
                    <input 
                      type="file" 
                      accept="image/*"
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setProfile({...profile, avatar: reader.result as string});
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Full Name</label>
                    <input 
                      type="text" 
                      value={profile.fullName}
                      onChange={e => setProfile({...profile, fullName: e.target.value})}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Email Address</label>
                    <input 
                      type="email" 
                      value={profile.email}
                      onChange={e => setProfile({...profile, email: e.target.value})}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Organization / Department</label>
                    <input 
                      type="text" 
                      value={profile.organization}
                      onChange={e => setProfile({...profile, organization: e.target.value})}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Security Settings</h3>
                  <p className="text-sm text-slate-500 mt-1">Manage your credentials and access permissions</p>
                </div>
                <button 
                  onClick={handleSaveSecurity}
                  className="flex items-center gap-2 px-4 py-2 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                  {isSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                  {isSaved ? 'Saved' : 'Save Security'}
                </button>
              </div>
              <div className="max-w-2xl space-y-8">
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-slate-800">Change Password</h4>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Current Password</label>
                      <input 
                        type="password"
                        placeholder="••••••••"
                        value={passwords.current}
                        onChange={e => setPasswords({...passwords, current: e.target.value})}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">New Password</label>
                        <input 
                          type="password"
                          value={passwords.new}
                          onChange={e => setPasswords({...passwords, new: e.target.value})}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Confirm New Password</label>
                        <input 
                          type="password"
                          value={passwords.confirm}
                          onChange={e => setPasswords({...passwords, confirm: e.target.value})}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
