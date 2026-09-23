import { useEffect, useState } from 'react';
import { PROFILES_EVENT, activeProfile, loadProfiles, type Profile } from '@/lib/profiles';

/** The profile in use, and how many there are; follows every change. */
export function useActiveProfile(): { profile: Profile; count: number } {
  const read = () => ({ profile: activeProfile(), count: loadProfiles().length });
  const [state, setState] = useState(read);
  useEffect(() => {
    const on = () => setState(read());
    window.addEventListener(PROFILES_EVENT, on);
    on();
    return () => window.removeEventListener(PROFILES_EVENT, on);
  }, []);
  return state;
}
