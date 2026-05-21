import { AlertTriangle } from 'lucide-react';
import { useMyUserServices, findUrgentService, daysUntil } from '@/hooks/useUserServices';

interface Props {
  onOpenDashboard?: () => void;
}

const ServiceExpirationBanner = ({ onOpenDashboard }: Props) => {
  const { services } = useMyUserServices();
  const urgent = findUrgentService(services);
  if (!urgent) return null;

  const days = daysUntil(urgent.expiration_date);
  const name = urgent.service_name || urgent.service_type || 'Your service';
  let msg = '';
  let critical = false;
  if (days !== null) {
    if (days < 0) { msg = `${name} expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`; critical = true; }
    else if (days === 0) { msg = `${name} expires today.`; critical = true; }
    else { msg = `${name} expires in ${days} day${days === 1 ? '' : 's'}.`; }
  }

  return (
    <button
      type="button"
      onClick={onOpenDashboard}
      className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium shadow-lg transition-all hover:scale-105 ${
        critical
          ? 'bg-red-600 text-white shadow-red-500/40'
          : 'bg-amber-500 text-black shadow-amber-500/40'
      }`}
    >
      <AlertTriangle className="w-4 h-4" />
      <span className="hidden sm:inline">{msg}</span>
      <span className="sm:hidden">Service expiring</span>
      <span className="underline opacity-90">Manage</span>
    </button>
  );
};

export default ServiceExpirationBanner;
