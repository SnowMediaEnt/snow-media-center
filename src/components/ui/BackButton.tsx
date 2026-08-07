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
  ({ onClick, label = 'Back to Home', focused = false, className, focusId = 'back', id, disabled }, ref) => (
    <Button
      ref={ref}
      id={id}
      onClick={onClick}
      disabled={disabled}
      variant="gold"
      size="lg"
      data-focus-id={focusId}
      data-focused={focused ? 'true' : 'false'}
      className={cn(
        'tv-focusable transition-all duration-150',
        focused && 'ring-4 ring-brand-gold scale-105 shadow-[0_0_22px_rgba(185,162,121,0.75)] brightness-110',
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
