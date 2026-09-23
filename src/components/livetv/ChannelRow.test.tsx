import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChannelRow from './ChannelRow';

const ch = { stream_id: 1, name: 'US| ESPN', num: 5, stream_icon: '', category_id: '1' } as never;

describe('ChannelRow', () => {
  it.each(['classic', 'compact', 'tile'] as const)('shows the down triangle in the %s layout', (variant) => {
    render(<ChannelRow channel={ch} index={0} isFocused={false} isPlaying={false} isFavorite={false} isDown onSelect={() => {}} onActivate={() => {}} variant={variant} />);
    expect(screen.getAllByLabelText('Reported down right now').length).toBeGreaterThan(0);
  });
});
