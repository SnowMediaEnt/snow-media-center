import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  getMailState, markMailRead, subscribeMail, unreadMail, useMailNotify,
  type MailState, type SnowMail,
} from '@/lib/snowMail';

interface Options {
  /** Show a heads-up toast when new mail lands while the app is open. Only
   *  the home screen passes this, so one arrival never toasts twice. */
  announce?: boolean;
}

/**
 * Mail from Snow Media for this viewer: the list, how many are unopened, and
 * how many to actually show as a badge (zero when notifications are off).
 */
export function useSnowMail(opts: Options = {}) {
  const [state, setState] = useState<MailState>(() => getMailState());
  const notify = useMailNotify();
  const { toast } = useToast();
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => subscribeMail(() => setState({ ...getMailState() })), []);

  // New arrival heads-up: anything that appears after the first load.
  useEffect(() => {
    if (!opts.announce || !state.loaded) return;
    if (!seenRef.current) { seenRef.current = new Set(state.mails.map((m) => m.id)); return; }
    const fresh = state.mails.filter((m) => !seenRef.current!.has(m.id));
    for (const m of state.mails) seenRef.current.add(m.id);
    if (!notify || fresh.length === 0) return;
    const newest = fresh[0];
    toast({
      title: fresh.length === 1 ? 'New post from Snow Media' : `${fresh.length} new posts from Snow Media`,
      description: newest.subject,
    });
  }, [opts.announce, state, notify, toast]);

  const markRead = useCallback((mail: SnowMail) => markMailRead(getMailState().viewer, mail.id), []);

  const unread = unreadMail(state);
  return {
    mails: state.mails,
    loaded: state.loaded,
    readIds: state.readIds,
    unreadCount: unread.length,
    /** What the badges show — nothing while notifications are switched off. */
    badgeCount: notify ? unread.length : 0,
    notify,
    markRead,
  };
}
