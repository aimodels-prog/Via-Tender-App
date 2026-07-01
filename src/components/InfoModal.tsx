import { CheckCircle2, Info, XCircle } from 'lucide-react';

interface InfoModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  variant?: 'success' | 'info' | 'error';
  confirmText?: string;
  onClose: () => void;
}

export default function InfoModal({
  isOpen,
  title,
  message,
  variant = 'info',
  confirmText = 'OK',
  onClose,
}: InfoModalProps) {
  if (!isOpen) return null;

  const styles = {
    success: {
      icon: CheckCircle2,
      iconClass: 'text-emerald-600 bg-emerald-50 border-emerald-100',
      buttonClass: 'bg-[#004b87] hover:bg-blue-900',
    },
    info: {
      icon: Info,
      iconClass: 'text-blue-600 bg-blue-50 border-blue-100',
      buttonClass: 'bg-[#004b87] hover:bg-blue-900',
    },
    error: {
      icon: XCircle,
      iconClass: 'text-red-600 bg-red-50 border-red-100',
      buttonClass: 'bg-red-600 hover:bg-red-700',
    },
  }[variant];
  const Icon = styles.icon;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl animate-in">
        <div className="p-5">
          <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-full border ${styles.iconClass}`}>
            <Icon size={22} />
          </div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        </div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50 p-4">
          <button
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${styles.buttonClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
