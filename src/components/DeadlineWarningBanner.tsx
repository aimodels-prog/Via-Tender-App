import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { AlertCircle, Clock, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const isCloseToDeadline = (deadlineStr: string) => {
  if (!deadlineStr) return false;
  const deadline = new Date(deadlineStr);
  const now = new Date();
  const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 3600 * 24));
  return diffDays >= 0 && diffDays <= 7;
};

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export default function DeadlineWarningBanner() {
  const [closingTenders, setClosingTenders] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkDeadlines = async () => {
      try {
        const today = new Date().toDateString();
        let ackDataStr = localStorage.getItem('deadlineAck');
        let ackInfo = ackDataStr ? JSON.parse(ackDataStr) : { date: '', count: 0, firstTime: 0 };

        if (ackInfo.date !== today) {
          ackInfo = { date: today, count: 0, firstTime: 0 };
        }

        if (ackInfo.count >= 2) return;

        if (ackInfo.count === 1) {
          const timeSinceFirst = new Date().getTime() - ackInfo.firstTime;
          if (timeSinceFirst < FOUR_HOURS_MS) {
            return;
          }
        }

        const data = await api.getTenders();
        const soonToClose = data.filter((t: any) => isCloseToDeadline(t.deadline));
        
        if (soonToClose.length > 0) {
          setClosingTenders(soonToClose);
          setIsOpen(true);
        }
      } catch (err) {
        console.error("Failed to check tender deadlines:", err);
      }
    };

    checkDeadlines();
  }, []);

  const handleAcknowledge = () => {
    const today = new Date().toDateString();
    let ackDataStr = localStorage.getItem('deadlineAck');
    let ackInfo = ackDataStr ? JSON.parse(ackDataStr) : { date: '', count: 0, firstTime: 0 };

    if (ackInfo.date !== today) {
      ackInfo = { date: today, count: 0, firstTime: 0 };
    }

    ackInfo.count += 1;
    if (ackInfo.count === 1) {
      ackInfo.firstTime = new Date().getTime();
    }
    
    localStorage.setItem('deadlineAck', JSON.stringify(ackInfo));
    setIsOpen(false);
  };

  if (!isOpen || closingTenders.length === 0) return null;

  return (
    <div className="w-full bg-rose-50 border border-rose-200 rounded-xl p-4 mb-8 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="text-[15px] font-bold text-rose-700 flex items-center gap-2">
            <AlertCircle size={18} />
            Tenders Closing Soon
          </h2>
          <p className="text-sm text-rose-600/80 mt-1">
            The following tenders have deadlines approaching within the next 7 days.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAcknowledge}
            className="px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-100 hover:bg-rose-200 rounded-lg transition-colors border border-transparent"
          >
            Acknowledge
          </button>
          <button onClick={handleAcknowledge} className="text-rose-400 hover:text-rose-600 rounded-lg hover:bg-rose-100 p-1 transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>
      
      <div className="space-y-2">
        {closingTenders.map(tender => {
          const daysLeft = Math.ceil((new Date(tender.deadline).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
          return (
            <div key={tender.id} className="p-3 border border-rose-100 bg-white rounded-lg flex flex-col sm:flex-row sm:items-center justify-between hover:shadow-md transition-shadow gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-900 text-sm whitespace-normal">{tender.tender_title || tender.name || 'Untitled Tender'}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{tender.client || "Confidential Authority"}</p>
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-rose-50 text-rose-700 text-xs font-bold">
                  <Clock size={12} className="opacity-75" />
                  {daysLeft === 0 ? "Today" : `${daysLeft} Day${daysLeft > 1 ? 's' : ''} Left`}
                </span>
                <button
                  onClick={() => {
                    handleAcknowledge();
                    navigate(`/tenders/${tender.id}/details`);
                  }}
                  className="text-xs font-medium text-rose-600 hover:text-rose-800 flex items-center gap-1"
                >
                  View Details &rarr;
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
