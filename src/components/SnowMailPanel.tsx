// The Posts tab in Support: everything Snow Media has sent, newest first,
// dated, with the ones this viewer has not opened marked. OK opens one full
// screen (SnowMailReader).
//
// Embedded under the Support tab row: the parent hands focus down with the
// 'snow-mail:focus-list' event, and Up from the first row (or Back) hands it
// back through 'support:focus-tab'.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Newspaper, ChevronRight, BellOff } from 'lucide-react';
import { useTVFocus, type TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { useSnowMail } from '@/hooks/useSnowMail';
import { mailDate, type SnowMail } from '@/lib/snowMail';
import SnowMailReader from '@/components/SnowMailReader';

const SnowMailPanel = () => {
  const { mails, loaded, readIds, markRead, notify } = useSnowMail();
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState<SnowMail | null>(null);

  const escapeUp = useCallback(() => {
    setActive(false);
    window.dispatchEvent(new CustomEvent('support:focus-tab', { detail: { tab: 'mail' } }));
  }, []);

  const navigation = useMemo<TVFocusNavigationMap>(() => {
    const map: TVFocusNavigationMap = {};
    mails.forEach((m, i) => {
      map[`mail-${m.id}`] = {
        up: i === 0 ? () => { escapeUp(); return null; } : `mail-${mails[i - 1].id}`,
        down: i === mails.length - 1 ? () => null : `mail-${mails[i + 1].id}`,
        left: () => null,
        right: () => null,
      };
    });
    map['mail-empty'] = { up: () => { escapeUp(); return null; }, down: () => null, left: () => null, right: () => null };
    return map;
  }, [mails, escapeUp]);

  const firstId = mails[0] ? `mail-${mails[0].id}` : 'mail-empty';
  const focus = useTVFocus({
    initialFocusId: firstId,
    navigation,
    onBack: escapeUp,
    autoFocusOnMount: false,
    enabled: active && !open,
    scrollBlock: 'nearest',
  });

  useEffect(() => {
    const handler = () => {
      setActive(true);
      requestAnimationFrame(() => focus.focusById(firstId, 'nearest'));
    };
    window.addEventListener('snow-mail:focus-list', handler);
    return () => window.removeEventListener('snow-mail:focus-list', handler);
  }, [focus, firstId]);

  const openMail = useCallback((m: SnowMail) => {
    markRead(m);
    setOpen(m);
  }, [markRead]);

  const closeMail = useCallback(() => {
    const id = open?.id;
    setOpen(null);
    setActive(true);
    requestAnimationFrame(() => focus.focusById(id ? `mail-${id}` : firstId, 'nearest'));
  }, [open, focus, firstId]);

  return (
    <div ref={focus.containerRef} className="w-full">
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-3 text-white/80">
          <Newspaper className="w-6 h-6 text-brand-gold" />
          <span className="text-lg font-semibold">Posts from Snow Media Entertainment</span>
        </div>
        {!notify && (
          <span className="flex items-center gap-2 text-sm text-white/50"><BellOff className="w-4 h-4" /> Notifications off (Settings → UI)</span>
        )}
      </div>

      {!loaded && (
        <div className="text-white/60 text-lg px-1 py-6">Checking for posts…</div>
      )}

      {loaded && mails.length === 0 && (
        <div
          data-tv-focus-id="mail-empty"
          tabIndex={0}
          className={`rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center outline-none ${focus.currentFocusId === 'mail-empty' && active ? 'ring-2 ring-brand-gold' : ''}`}
        >
          <Newspaper className="w-10 h-10 text-white/40 mx-auto mb-3" />
          <div className="text-xl font-semibold text-white/80">Nothing here yet</div>
          <div className="text-base text-white/55 mt-1">When Snow Media posts news, deals or event announcements, they land here — dated, and marked until you open them.</div>
        </div>
      )}

      {mails.length > 0 && (
        <div className="flex flex-col gap-2">
          {mails.map((m) => {
            const unread = !readIds.has(m.id);
            const id = `mail-${m.id}`;
            const focused = active && focus.currentFocusId === id;
            return (
              <div
                key={m.id}
                data-tv-focus-id={id}
                tabIndex={0}
                role="button"
                onClick={() => openMail(m)}
                className={`grid grid-cols-[6.5rem_1fr_auto] items-center gap-4 rounded-2xl px-5 py-4 outline-none cursor-pointer transition-all ${
                  focused ? 'bg-brand-gold text-slate-900 ring-4 ring-brand-gold shadow-lg' : unread ? 'bg-white/[0.08] text-white' : 'bg-white/[0.04] text-white/80'
                }`}
              >
                <div className={`text-sm font-bold uppercase tracking-wide ${focused ? 'text-slate-800' : 'text-white/60'}`}>
                  {mailDate(m.sentAt)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-xl truncate ${unread ? 'font-extrabold' : 'font-semibold'}`}>{m.subject}</span>
                    {unread && (
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider ${focused ? 'bg-slate-900 text-brand-gold' : 'bg-brand-gold text-slate-900'}`}>
                        New
                      </span>
                    )}
                  </div>
                  {m.preheader && (
                    <div className={`text-base truncate mt-0.5 ${focused ? 'text-slate-800/80' : 'text-white/55'}`}>{m.preheader}</div>
                  )}
                </div>
                <ChevronRight className={`w-6 h-6 ${focused ? 'text-slate-900' : 'text-white/40'}`} />
              </div>
            );
          })}
        </div>
      )}

      {open && <SnowMailReader mail={open} onClose={closeMail} />}
    </div>
  );
};

export default SnowMailPanel;
