import { forwardRef, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Coins, Loader2, Sparkles, WifiOff } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GameAccent, GameFairInfo } from './gameTypes';

export const GAME_ACTION_CLASS = 'snow-game-action tv-ring min-h-12 border-2 font-black transition-transform duration-150';

export const GameShell = ({ accent, children, className }: { accent: GameAccent; children: ReactNode; className?: string }) => (
  <main className={cn('snow-casino tv-game-shell', `snow-casino--${accent}`, className)} data-game-accent={accent}>
    <div className="snow-casino__aurora" aria-hidden="true" />
    <div className="snow-casino__vignette" aria-hidden="true" />
    <div className="tv-game-body snow-game-body">{children}</div>
  </main>
);

export const GameTopBar = forwardRef<HTMLButtonElement, {
  onBack: () => void;
  backLabel: string;
  balance: number | null;
  status?: string;
  title?: string;
  phase?: string;
  backFocused?: boolean;
  onBackFocus?: () => void;
  reducedFx?: boolean;
  onToggleFx?: () => void;
}>(({ onBack, backLabel, balance, status, title, phase, backFocused, onBackFocus, reducedFx, onToggleFx }, ref) => (
  <header className="snow-game-topbar">
    <BackButton ref={ref} onClick={onBack} label={backLabel} focused={backFocused} onFocus={onBackFocus} className="snow-game-back" />
    {(title || phase) && <div className="snow-game-heading"><h1>{title}</h1>{phase && <span>{phase}</span>}</div>}
    <div className="snow-game-topbar__right">
      {onToggleFx && (
        <Button type="button" variant="navy" size="sm" onClick={onToggleFx} aria-pressed={reducedFx} className="snow-game-fx-toggle">
          <Sparkles /> FX {reducedFx ? 'Low' : 'Full'}
        </Button>
      )}
      <div className="snow-chip-badge" aria-label="Play Chips balance">
        {status === 'error' || status === 'reconnecting' ? <WifiOff /> : status === 'connecting' ? <Loader2 className="animate-spin" /> : <Coins />}
        <span><small>PLAY CHIPS</small><strong>{balance === null ? '—' : balance.toLocaleString()}</strong></span>
      </div>
    </div>
  </header>
));
GameTopBar.displayName = 'GameTopBar';

export const GamePanel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <section className={cn('snow-game-panel', className)}>{children}</section>
);

export const BetChip = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; focused?: boolean }>(
  ({ selected, focused, className, children, ...props }, ref) => (
    <Button ref={ref} type="button" variant="navy" {...props} data-tv-focused={focused ? 'true' : 'false'} className={cn('snow-bet-chip', selected && 'is-selected', className)}>
      {children}
    </Button>
  ),
);
BetChip.displayName = 'BetChip';

export const ResultBanner = ({ tone, title, children, active = true }: { tone: 'win' | 'lose' | 'push' | 'info'; title: ReactNode; children?: ReactNode; active?: boolean }) => (
  <div className={cn('snow-result-banner', `snow-result-banner--${tone}`, active && 'is-active')} role="status" aria-live="polite">
    <strong>{title}</strong>{children && <div>{children}</div>}
  </div>
);

export const FairnessPanel = forwardRef<HTMLButtonElement, {
  fair?: GameFairInfo | null;
  hash?: string;
  open: boolean;
  onToggle: () => void;
  focused?: boolean;
  onFocus?: () => void;
  labels?: Partial<Record<'title' | 'hash' | 'server' | 'client' | 'nonce' | 'note', string>>;
  verification?: ReactNode;
}>(({ fair, hash, open, onToggle, focused, onFocus, labels = {}, verification }, ref) => (
  <div className="snow-fairness">
    <Button ref={ref} type="button" variant="navy" size="sm" onClick={onToggle} onFocus={onFocus} data-tv-focused={focused ? 'true' : 'false'} className="snow-fairness__toggle">
      {open ? <ChevronUp /> : <ChevronDown />}{labels.title ?? 'Provably fair'}
    </Button>
    {open && (
      <div className="snow-fairness__details">
        {(fair?.serverSeedHash || hash) && <p><b>{labels.hash ?? 'Server seed hash:'}</b> {fair?.serverSeedHash || hash}</p>}
        {fair?.serverSeed && <p><b>{labels.server ?? 'Server seed:'}</b> {fair.serverSeed}</p>}
        {fair?.clientSeed && <p><b>{labels.client ?? 'Client seed:'}</b> {fair.clientSeed}</p>}
        {fair && <p><b>{labels.nonce ?? 'Nonce:'}</b> {fair.nonce}</p>}
        {verification ?? (labels.note && <p>{labels.note}</p>)}
      </div>
    )}
  </div>
));
FairnessPanel.displayName = 'FairnessPanel';
