import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';

const Welcome = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-6">
      <div className="max-w-md w-full bg-white/5 border border-blue-500/30 rounded-2xl p-8 text-center space-y-5">
        <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto" />
        <h1 className="text-3xl font-bold">{t('auth.welcome.title')}</h1>
        <p className="text-blue-100">
          {t('auth.welcome.body')}
        </p>
        <p className="text-sm text-blue-200/80">
          {t('auth.welcome.note')}
        </p>
        <Link to="/auth">
          <Button size="lg" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            {t('auth.welcome.goSignInBtn')}
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default Welcome;
