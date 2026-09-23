// Shows the profile screens: "Who's watching?" when the app starts and there
// is a choice to make (see initProfiles), and whenever something asks for
// them (profilesUi.openProfiles). Lives on the home route.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { OPEN_PROFILES_EVENT, grownUpsWithPin, initProfiles } from '@/lib/profiles';
import type { OpenProfilesDetail } from '@/lib/profilesUi';
import type { ProfileScreensMode } from '@/components/profiles/ProfileScreens';

const ProfileScreens = lazy(() => import('@/components/profiles/ProfileScreens'));

interface Props {
  /** True while the screens cover the app (other start-up popups wait). */
  onOpenChange?: (open: boolean) => void;
}

const ProfileGate = ({ onOpenChange }: Props) => {
  const [mode, setMode] = useState<ProfileScreensMode | null>(null);
  // Until the start-up check has answered, the app counts as covered.
  const [checked, setChecked] = useState(false);
  const onOkRef = useRef<(() => void) | undefined>();

  useEffect(() => {
    let alive = true;
    void initProfiles().then(({ needsPick }) => {
      if (!alive) return;
      if (needsPick) setMode('gate');
      setChecked(true);
    }).catch(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<OpenProfilesDetail>).detail;
      if (!d) return;
      if (d.mode === 'grownup') {
        // Nobody grown-up has a PIN: nothing to ask.
        if (grownUpsWithPin().length === 0) { d.onOk?.(); return; }
        onOkRef.current = d.onOk;
      }
      setMode((m) => m ?? d.mode);
    };
    window.addEventListener(OPEN_PROFILES_EVENT, on);
    return () => window.removeEventListener(OPEN_PROFILES_EVENT, on);
  }, []);

  const open = !checked || mode != null;
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  if (!mode) return null;
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[150]" style={{ backgroundColor: '#071b3a' }} aria-hidden="true" />}>
      <ProfileScreens
        mode={mode}
        onClose={() => setMode(null)}
        onGrownUpOk={() => { const ok = onOkRef.current; onOkRef.current = undefined; setMode(null); ok?.(); }}
      />
    </Suspense>
  );
};

export default ProfileGate;
