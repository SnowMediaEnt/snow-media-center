import { memo, useEffect, useRef } from 'react';
import { ArrowLeft, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  /** Leave for the Player's mode chooser. */
  onBack: () => void;
}

/**
 * Live TV on a Kids profile when no line is saved on the box. Shown in place
 * of the sign-in form, which also sells a line: nothing to type and nothing
 * to buy here, only who to ask. OK or Back leaves.
 */
const KidsAskGrownUp = memo(({ onBack }: Props) => {
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => backRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      // The Player shell answers Back on this screen as well (it is where the
      // sign-in form would be): whichever hears the press first takes it.
      if (e.defaultPrevented) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (!isBack && !isOk && !isArrow) return;
      e.preventDefault();
      e.stopPropagation();
      // One button: the arrows have nowhere to go. A held OK (the one that
      // opened Live TV) is not a press on it.
      if (isArrow || (isOk && e.repeat)) return;
      onBack();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onBack]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-white bg-black/70">
      <div className="max-w-xl w-full rounded-3xl bg-gradient-to-br from-sky-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 p-10 text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-brand-gold/20 flex items-center justify-center mb-5">
          <Tv className="w-11 h-11 text-brand-gold" />
        </div>
        <h2 className="text-3xl font-quicksand font-bold mb-3">
          Ask a grown-up to sign in to Live TV
        </h2>
        <p className="text-brand-ice/90 font-nunito text-lg leading-relaxed mb-8">
          Live TV isn&apos;t set up on this TV yet. Once a grown-up has signed in,
          your channels will be waiting right here.
        </p>
        <Button
          ref={backRef}
          variant="gold"
          onClick={onBack}
          data-focused="true"
          className="min-w-[160px] h-12 rounded-xl text-base font-semibold tv-ring tv-ring-contrast relative transition-transform duration-150 ease-out scale-105 z-10"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      </div>
    </div>
  );
});

KidsAskGrownUp.displayName = 'KidsAskGrownUp';
export default KidsAskGrownUp;
