import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const Spinner = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 text-brand-ice/90 font-nunito">
    <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
    <span>{label}</span>
  </div>
);

export const RateLimitNote = ({ secondsLeft }: { secondsLeft: number }) => {
  const { t } = useTranslation();
  return secondsLeft > 0 ? (
    <p className="text-amber-200 text-sm font-nunito">{t('billing.rateLimit.wait', { seconds: secondsLeft })}</p>
  ) : null;
};
