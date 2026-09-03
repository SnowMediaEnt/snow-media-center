import { forwardRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BackButtonProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Button>, 'onClick' | 'variant' | 'size'> {
  onClick: () => void;
  label?: string;
  focused?: boolean;
  className?: string;
  focusId?: string;
  id?: string;
  disabled?: boolean;
}

/** The single Back control for the whole app. Always render it as the first
 *  child of a <div className={BACK_ROW}> at the top-left of the screen, and
 *  make sure the screen root carries `tv-scroll-container tv-safe` so it sits
 *  inside the TV overscan-safe area. Never position it fixed or absolute. */
export const BackButton = forwardRef<HTMLButtonElement, BackButtonProps>(
  ({ onClick, label = 'Back to Home', focused = false, className, focusId = 'back', id, disabled, ...rest }, ref) => (
    <Button
      ref={ref}
      id={id}
      onClick={onClick}
      disabled={disabled}
      variant="gold"
      size="lg"
      data-focus-id={focusId}
      data-focused={focused ? 'true' : 'false'}
      {...rest}
      className={cn(
        // tv-ring-contrast, not tv-ring: variant="gold" is a solid gold fill,
        // and a gold ring on it is invisible. This variant draws white.
        //
        // The old style was `ring-4 ring-brand-gold shadow-[0_0_22px_...]`.
        // Tailwind's ring and shadow-[…] are both box-shadow, and the
        // low-memory rules strip box-shadow from anything whose class contains
        // `shadow-[` — so on a Fire TV this button had no ring of its own and
        // fell through to the browser's default focus outline.
        'tv-ring tv-ring-contrast transition-all duration-150',
        focused && 'scale-105 brightness-110',
        className
      )}
    >
      <ArrowLeft className="w-5 h-5 mr-2" />
      {label}
    </Button>
  )
);
BackButton.displayName = 'BackButton';

export const BACK_ROW = 'flex items-center w-full justify-start mb-6';
