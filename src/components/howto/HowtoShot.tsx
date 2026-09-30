// Stub from the shared contract (plan-howto.md 1b); item B replaces it.
import type { HowtoArt } from '@/data/howtoContract';

export interface HowtoShotProps { art: HowtoArt; titleKey?: string }

export default function HowtoShot(_p: HowtoShotProps) { return null; }
