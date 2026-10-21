import { forwardRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { keepTypingFocus } from '@/utils/keepTypingFocus';

interface PasswordRevealButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children' | 'aria-label' | 'aria-pressed'> {
  /** The password is showing as text. */
  shown: boolean;
  onToggle: () => void;
}

/**
 * Show / Hide inside the right end of a password box: Eye + "Show" while it
 * is dots, EyeOff + "Hide" while it is text. The caller flips the input's
 * type between "password" and "text" (the typed value stays), starts it
 * hidden every time the screen opens, and gives the field autoComplete="off",
 * autoCorrect="off", autoCapitalize="none" and spellCheck={false}: as text it
 * must not autocorrect, capitalise or suggest.
 *
 * Layout: inside a `relative` wrapper, BEFORE the <input> in the DOM. The
 * remote's keyboard Next / Done after the password lands on whatever follows
 * the field in DOM order (useTVFocus advanceFrom), which must stay Sign in,
 * not this. The input takes PASSWORD_REVEAL_PAD so its text never runs under
 * the button. Absolute offsets and margins only (Chrome 66: no flex gap, no
 * `inset` shorthand).
 *
 * A tap while the field has the phone's keyboard up toggles without taking
 * the focus from it (keepTypingFocus), so the keyboard stays up.
 */
export const PasswordRevealButton = forwardRef<HTMLButtonElement, PasswordRevealButtonProps>(
  ({ shown, onToggle, onClick, onMouseDown, className, ...rest }, ref) => {
    const { t } = useTranslation();
    const Icon = shown ? EyeOff : Eye;
    return (
      <button
        ref={ref}
        type="button"
        {...rest}
        aria-label={shown ? t('liveAccount.account.hidePasswordBtn') : t('liveAccount.account.showPasswordBtn')}
        aria-pressed={shown}
        data-password-reveal=""
        onMouseDown={(e) => { keepTypingFocus(e); onMouseDown?.(e); }}
        onClick={(e) => { onClick?.(e); onToggle(); }}
        className={cn(
          'absolute top-1 bottom-1 right-1 z-10 flex items-center rounded-lg px-2',
          'font-nunito font-semibold text-sm text-brand-ice/90 hover:bg-white/10',
          'data-[focused=true]:bg-white/15 data-[tv-focused=true]:bg-white/15',
          'disabled:opacity-50 disabled:pointer-events-none',
          className,
        )}
      >
        <Icon className="w-4 h-4 mr-1 shrink-0" aria-hidden="true" />
        <span className="whitespace-nowrap">{shown ? t('common.passwordReveal.hideBtn') : t('common.passwordReveal.showBtn')}</span>
      </button>
    );
  },
);
PasswordRevealButton.displayName = 'PasswordRevealButton';

/**
 * Right padding for the password input beside the button: room for the
 * longest word (the locale check caps a *Btn label at 9 letters here).
 */
export const PASSWORD_REVEAL_PAD = 'pr-32';

