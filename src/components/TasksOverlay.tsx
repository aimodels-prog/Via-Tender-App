import React from 'react';
import { useTasks } from '../lib/TasksContext';
import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import clsx from 'clsx';

export default function TasksOverlay() {
  const { tasks, removeTask } = useTasks();

  if (tasks.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 w-80">
      {tasks.map(task => (
        <div key={task.id} className="bg-white rounded-xl shadow-xl shadow-slate-200/50 border border-slate-200 p-4 relative overflow-hidden group">
          {task.status === 'running' && (
            <div 
              className="absolute bottom-0 left-0 h-1 bg-blue-600 transition-all duration-500 ease-out z-0"
              style={{ width: `${task.percent}%` }}
            ></div>
          )}
          
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-1">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 truncate">
                  {task.title}
                </h4>
                {task.status === 'running' && (
                  <span className="text-[10px] font-black tracking-tight text-blue-600">{task.percent}%</span>
                )}
              </div>
              
              {task.message && (
                <p className="text-[10px] text-slate-500 font-medium truncate mb-2">{task.message}</p>
              )}

              <div className="flex items-center gap-2">
                {task.status === 'running' && <Loader2 size={12} className="animate-spin text-blue-600" />}
                {task.status === 'completed' && <CheckCircle2 size={12} className="text-green-500" />}
                {task.status === 'error' && <XCircle size={12} className="text-red-500" />}
                
                <span className={clsx(
                  "text-[10px] font-black uppercase tracking-widest",
                  task.status === 'running' ? "text-blue-600" :
                  task.status === 'completed' ? "text-green-500" : "text-red-500"
                )}>
                  {task.status === 'running' ? `ETA: ~${task.eta}s` : task.status}
                </span>
              </div>
            </div>

            <button 
              onClick={() => removeTask(task.id)}
              className="text-slate-400 hover:text-slate-900 transition-colors opacity-0 group-hover:opacity-100 p-1 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
