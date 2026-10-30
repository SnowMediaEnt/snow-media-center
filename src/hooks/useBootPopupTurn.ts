// A boot popup's turn on screen (see utils/bootPopupQueue).
//
// `want`: the popup has something to show. Returns true once it is this
// popup's turn: no other popup is on screen and the shared slot was free.
// It keeps the turn until `want` goes false or it unmounts, then hands the
// slot on. While it waits it looks again every `pollMs` — only while
// waiting, never once it is showing or has nothing to show.
import { useEffect, useState } from 'react';
import { claimBootPopup, otherPopupOpen, releaseBootPopup } from '@/utils/bootPopupQueue';

export function useBootPopupTurn(id: string, want: boolean, pollMs = 500): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!want) {
      releaseBootPopup(id);
      setHas(false);
      return undefined;
    }
    const take = (): boolean => {
      if (otherPopupOpen()) return false;
      if (!claimBootPopup(id)) return false;
      setHas(true);
      return true;
    };
    if (take()) return undefined;
    const timer = window.setInterval(() => { if (take()) window.clearInterval(timer); }, pollMs);
    return () => window.clearInterval(timer);
  }, [id, want, pollMs]);
  useEffect(() => () => releaseBootPopup(id), [id]);
  return want && has;
}
