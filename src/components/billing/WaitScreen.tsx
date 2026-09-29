import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useTVFocus } from '@/hooks/useTVFocus';
import { BTN, CARD, SCREEN, focusAttrs, scaleIf } from './shared';

interface Props {
  title: string;
  detail?: string;
  /** When given, Back is allowed and a Back button is shown. */
  onBack?: () => void;
  backLabel?: string;
  error?: boolean;
}

/**
 * Full-screen "working…" (or "that failed") card. It always has one managed
 * focusable so the remote's keys are swallowed here rather than reaching the
 * screen underneath; without an onBack the Back key does nothing, which is
 * right while a trial is being provisioned.
 */
const WaitScreen = memo(({ title, detail, onBack, backLabel, error }: Props) => {
  const { t } = useTranslation();
  const { containerRef, currentFocusId } = useTVFocus({
    initialFocusId: 'wait-back',
    onBack: () => { onBack?.(); },
  });
  return (
    <div ref={containerRef} className={SCREEN}>
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className={`${CARD} w-full max-w-xl p-8 text-center`}>
          {!error && <Loader2 className="w-12 h-12 animate-spin text-brand-gold mx-auto" />}
          <h2 className={`mt-4 text-2xl font-quicksand font-bold ${error ? 'text-red-200' : 'text-white'}`}>{title}</h2>
          {detail && <p className="mt-2 text-brand-ice/80 font-nunito">{detail}</p>}
          {onBack ? (
            <Button variant="white" onClick={onBack}
              className={`${BTN} mt-6 ${scaleIf(currentFocusId, 'wait-back')}`} {...focusAttrs(currentFocusId, 'wait-back')}>
              <ArrowLeft className="w-4 h-4 mr-2" /> {backLabel ?? t('common.back')}
            </Button>
          ) : (
            <div className="sr-only" aria-hidden="true" {...focusAttrs(currentFocusId, 'wait-back')} />
          )}
        </Card>
      </div>
    </div>
  );
});

WaitScreen.displayName = 'WaitScreen';
export default WaitScreen;
