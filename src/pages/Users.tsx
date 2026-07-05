import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, Trash2, Edit, ChevronDown, ChevronUp, ArrowUpAZ, ArrowDownZA, UserPlus, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import PromptModal from '../components/PromptModal';
import { useAuth } from '../lib/auth';

export default function Users() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [lookups, setLookups] = useState<any>({ roles: ['User', 'Admin'], userStatuses: ['Active', 'Inactive'] });
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);
  const activeColumnMenuRef = useRef<HTMLDivElement>(null);

  const fetchUsers = async () => {
    const data = await api.getUsers();
    setUsers(data);
  };

  const handleCreateUser = async (values: Record<string, string>) => {
    setFormError("");
    const name = values.name?.trim();
    const email = values.email?.trim().toLowerCase();
    const password = values.password || "";
    if (!name || !email || !password) {
      setFormError("Full name, email, and temporary password are required.");
      return;
    }
    if (password.length < 6) {
      setFormError("Temporary password must be at least 6 characters.");
      return;
    }
    const result = await api.addUser({
      name,
      email,
      password,
      role: values.role === 'Admin' ? 'Admin' : 'User',
      status: values.status === 'Inactive' ? 'Inactive' : 'Active',
    });
    if (!result?.success) {
      setFormError(result?.error || "Unable to create user.");
      return;
    }
    setIsCreateOpen(false);
    fetchUsers();
  };

  const handleUpdateUser = async (values: Record<string, string>) => {
    setFormError("");
    if (!editUser) return;
    const name = values.name?.trim();
    const email = values.email?.trim().toLowerCase();
    if (!name || !email) {
      setFormError("Full name and email are required.");
      return;
    }
    const updates: any = {
      name,
      email,
      role: values.role === 'Admin' ? 'Admin' : 'User',
      status: values.status === 'Inactive' ? 'Inactive' : 'Active',
    };
    if (values.password) updates.password = values.password;
    const result = await api.updateUser(editUser.id, updates);
    if (!result?.success) {
      setFormError(result?.error || "Unable to update user.");
      return;
    }
    setEditUser(null);
    fetchUsers();
  };

  useEffect(() => {
    fetchUsers();
    api.getLookups()
      .then((data) => {
        setLookups({
          roles: data.roles?.length ? data.roles : ['User', 'Admin'],
          userStatuses: data.userStatuses?.length ? data.userStatuses : ['Active', 'Inactive'],
        });
      })
      .catch((error) => {
        console.warn('User lookup values could not be loaded:', error);
      });
    function handleClickOutside(event: MouseEvent) {
      if (activeColumnMenuRef.current && !activeColumnMenuRef.current.contains(event.target as Node)) {
        setActiveColumnMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredUsers = users.filter(user => {
    const matchesSearch = (user.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
          (user.email || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    
    // Column filters
    for (const [key, value] of Object.entries(columnFilters)) {
      if (!value) continue;
      
      const v = String(value).toLowerCase();
      let userVal = "";
      
      if (key === 'user') userVal = `${user.name || ''} ${user.email || ''}`.toLowerCase();
      else if (key === 'role') userVal = (user.role || '').toLowerCase();
      else if (key === 'status') userVal = (user.status || 'Active').toLowerCase();
      
      if (!userVal.includes(v)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    const mod = direction === 'asc' ? 1 : -1;
    
    let aVal: any = "";
    let bVal: any = "";
    
    if (key === 'user') {
      aVal = a.name || '';
      bVal = b.name || '';
    } else if (key === 'role') {
      aVal = a.role || '';
      bVal = b.role || '';
    } else if (key === 'status') {
      aVal = a.status || 'Active';
      bVal = b.status || 'Active';
    } else if (key === 'lastLogin') {
      aVal = new Date(a.lastLogin || 0).getTime();
      bVal = new Date(b.lastLogin || 0).getTime();
    }
    
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    
    if (aVal < bVal) return -1 * mod;
    if (aVal > bVal) return 1 * mod;
    return 0;
  });

  const renderColumnHeader = (id: string, label: string) => (
    <th key={id} className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap relative">
      <div 
        className="flex items-center gap-1 cursor-pointer hover:text-slate-700 select-none"
        onClick={(e) => {
          e.stopPropagation();
          setActiveColumnMenu(activeColumnMenu === id ? null : id);
        }}
      >
        {label} 
        {sortConfig?.key === id ? (
          sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-blue-600" /> : <ChevronDown size={12} className="text-blue-600" />
        ) : (
          <ChevronDown size={12} className="opacity-50" />
        )}
      </div>

      {activeColumnMenu === id && (
        <div 
          ref={activeColumnMenuRef}
          className="absolute left-6 top-10 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-30 font-normal normal-case tracking-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-1">
            <div className="px-3 py-2 text-xs font-semibold text-slate-500">Sort</div>
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-sm font-medium text-slate-700 rounded-md transition-colors"
              onClick={() => {
                setSortConfig({ key: id, direction: 'asc' });
                setActiveColumnMenu(null);
              }}
            >
              <ArrowUpAZ size={14} className="text-slate-400" />
              <span>Sort Ascending</span>
            </button>
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-sm font-medium text-slate-700 rounded-md transition-colors"
              onClick={() => {
                setSortConfig({ key: id, direction: 'desc' });
                setActiveColumnMenu(null);
              }}
            >
              <ArrowDownZA size={14} className="text-slate-400" />
              <span>Sort Descending</span>
            </button>
          </div>
          <div className="h-px bg-slate-100 my-1"></div>
          <div className="p-1 border-t border-slate-100">
            <div className="px-3 py-2 text-xs font-semibold text-slate-500">Filter</div>
            <div className="px-2 pb-2">
              <input 
                type="text" 
                placeholder={`Filter ${label}...`}
                value={columnFilters[id] || ''}
                onChange={(e) => setColumnFilters(prev => ({ ...prev, [id]: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>
            {columnFilters[id] && (
               <div className="px-2 pb-2">
                  <button 
                    className="w-full text-xs text-blue-600 hover:text-blue-700 font-medium py-1"
                    onClick={() => setColumnFilters(prev => { const n = {...prev}; delete n[id]; return n; })}
                  >
                    Clear Filter
                  </button>
               </div>
            )}
          </div>
        </div>
      )}
    </th>
  );

  return (
    <div className="space-y-6 max-w-full w-full mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold text-slate-900 mb-1">User Management</h2>
          <p className="text-slate-500 text-sm">Manage user roles and account access</p>
        </div>
        <button
          onClick={() => {
            setFormError("");
            setIsCreateOpen(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm w-full sm:w-auto"
        >
          <UserPlus size={16} />
          Add User
        </button>
      </div>

      {formError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 shrink-0" size={16} />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users by name or email..."
            className="w-full bg-white border border-slate-200 rounded-lg py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
          />
        </div>
        <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium transition-colors shadow-sm w-full sm:w-auto">
          <Filter size={16} />
          Filters
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-200 bg-[#fafafa]">
                {renderColumnHeader('user', 'User')}
                {renderColumnHeader('role', 'Role')}
                {renderColumnHeader('status', 'Status')}
                {renderColumnHeader('lastLogin', 'Last Login')}
                <th className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length > 0 ? (
                filteredUsers.map(user => (
                  <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex items-center justify-center shrink-0">
                          {(user.name || '?').split(' ').map((n: string) => n[0]).join('')}
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-slate-900">{user.name}</p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={clsx(
                        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                        user.status === 'Active' ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                      )}>
                        {user.status || 'Active'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setFormError("");
                            setEditUser(user);
                          }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                          title="Edit User"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(user.id)}
                          disabled={String(currentUser?.id) === String(user.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400"
                          title={String(currentUser?.id) === String(user.id) ? "You cannot remove your own account" : "Remove User"}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">
                    No users found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!confirmDeleteId}
        title="Remove User"
        message="Are you sure you want to remove this user from the organization? They will immediately lose access."
        confirmText="Remove User"
        isDestructive={true}
        onConfirm={async () => {
          if (confirmDeleteId) {
            try {
              await api.deleteUser(confirmDeleteId);
            } catch (error: any) {
              setFormError(error.message || "Unable to delete user.");
            }
            setConfirmDeleteId(null);
            fetchUsers();
          }
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <PromptModal
        isOpen={isCreateOpen}
        title="Add User"
        fields={[
          { name: 'name', label: 'Full Name' },
          { name: 'email', label: 'Email Address' },
          { name: 'password', label: 'Temporary Password', type: 'password' },
          { name: 'role', label: 'Role', defaultValue: 'User', options: lookups.roles },
          { name: 'status', label: 'Status', defaultValue: 'Active', options: lookups.userStatuses }
        ]}
        confirmText="Create User"
        onConfirm={handleCreateUser}
        onCancel={() => {
          setIsCreateOpen(false);
          setFormError("");
        }}
      />

      <PromptModal
        isOpen={!!editUser}
        title="Edit User"
        fields={[
          { name: 'name', label: 'Full Name', defaultValue: editUser?.name },
          { name: 'email', label: 'Email Address', defaultValue: editUser?.email },
          { name: 'password', label: 'New Password (optional)', type: 'password' },
          { name: 'role', label: 'Role', defaultValue: editUser?.role === 'Admin' ? 'Admin' : 'User', options: lookups.roles },
          { name: 'status', label: 'Status', defaultValue: editUser?.status || 'Active', options: lookups.userStatuses }
        ]}
        confirmText="Save Changes"
        onConfirm={handleUpdateUser}
        onCancel={() => {
          setEditUser(null);
          setFormError("");
        }}
      />
    </div>
  );
}
