// The kids screen says "this device" on a phone or tablet, "this TV" on a TV
// (Tronix a57c9d7).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import KidsAskGrownUp from './KidsAskGrownUp';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

afterEach(() => { cleanup(); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('the kids screen', () => {
  it('a TV: "this TV"', () => {
    render(<KidsAskGrownUp onBack={() => {}} />);
    expect(document.body.textContent).toContain("isn't set up on this TV yet");
  });

  it('a phone: "this device"', () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    render(<KidsAskGrownUp onBack={() => {}} />);
    expect(document.body.textContent).toContain("isn't set up on this device yet");
    expect(document.body.textContent).not.toContain('this TV');
  });
});
