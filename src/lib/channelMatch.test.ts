/**
 * The same channel on another service (channelMatch): a wrong channel is
 * worse than none, so most of these are names that must NOT match.
 */
import { describe, expect, it } from 'vitest';
import { channelKey, findSameChannel } from './channelMatch';

type Ch = { name: string; stream_id: number; epg_channel_id?: string; category_id?: string };
let id = 1;
const ch = (name: string, epg?: string): Ch => ({ name, stream_id: id++, epg_channel_id: epg });
const find = (want: string | { name: string; epg_channel_id?: string }, names: Array<string | Ch>) => {
  const list = names.map((n) => (typeof n === 'string' ? ch(n) : n));
  const hit = findSameChannel(typeof want === 'string' ? { name: want } : want, list);
  return hit ? hit.name : null;
};

describe('channelKey: the decoration comes off', () => {
  it.each([
    ['US: ESPN', 'espn'],
    ['US | ESPN', 'espn'],
    ['US| ESPN', 'espn'],
    ['|US| ESPN', 'espn'],
    ['[US] ESPN', 'espn'],
    ['(US) ESPN', 'espn'],
    ['US - ESPN', 'espn'],
    ['USA: ESPN', 'espn'],
    ['UK• Sky News', 'sky news'],
    ['ESPN (US)', 'espn'],
    ['|US| [VIP] ESPN', 'espn'],
  ])('%s → %s', (raw, key) => {
    expect(channelKey(raw).key).toBe(key);
  });

  it.each([
    ['ESPN HD', 'espn'],
    ['ESPN FHD', 'espn'],
    ['ESPN UHD', 'espn'],
    ['ESPN SD', 'espn'],
    ['ESPN 4K', 'espn'],
    ['ESPN 1080p', 'espn'],
    ['ESPN 720P', 'espn'],
    ['ESPN HEVC', 'espn'],
    ['ESPN H265', 'espn'],
    ['ESPN H.265', 'espn'],
    ['ESPN 60FPS', 'espn'],
    ['ESPN 60 FPS', 'espn'],
    ['ESPN ᴴᴰ', 'espn'],
    ['ESPNᴴᴰ', 'espn'],
    ['ESPN ᶠᴴᴰ', 'espn'],
    ['ESPN RAW', 'espn'],
    ['ESPN (Backup)', 'espn'],
    ['ESPN Backup 2', 'espn'],
    ['ESPN [FHD/HEVC]', 'espn'],
  ])('%s → %s', (raw, key) => {
    expect(channelKey(raw).key).toBe(key);
  });

  it('keeps what makes it another channel', () => {
    expect(channelKey('ESPN 2').key).toBe('espn 2');
    expect(channelKey('ESPN2 HD').key).toBe('espn 2');
    expect(channelKey('ABC East').key).toBe('abc east');
    expect(channelKey('ABC (West)').key).toBe('abc west');
    expect(channelKey('Channel 4 +1').key).toBe('channel 4 + 1');
    expect(channelKey('Channel 4+1').key).toBe('channel 4 + 1');
    expect(channelKey('ESPN+').key).toBe('espn +');
    expect(channelKey('CNN International').key).toBe('cnn international');
  });

  it('does not take a channel\'s own short name for a country', () => {
    expect(channelKey('ABC - East').key).toBe('abc east');
    expect(channelKey('CNN: Live').key).toBe('cnn live');
    expect(channelKey('USA Network').key).toBe('usa network');
  });

  it('folds case, accents and punctuation', () => {
    expect(channelKey('Télé-Québec').key).toBe(channelKey('TELE QUEBEC').key);
    expect(channelKey('A&E').key).toBe(channelKey('A & E').key);
    expect(channelKey('  Nick   Jr.  ').key).toBe('nick jr');
    expect(channelKey('ESPN \u26bd\ufe0f').key).toBe('espn');
    expect(channelKey('\u2b50 ESPN \ud83c\udfc8').key).toBe('espn');
  });

  it('reads the quality and the country', () => {
    expect(channelKey('US: ESPN FHD')).toEqual({ key: 'espn', region: 'us', quality: 'fhd' });
    expect(channelKey('USA | ESPN ᴴᴰ')).toEqual({ key: 'espn', region: 'us', quality: 'hd' });
    expect(channelKey('ESPN')).toEqual({ key: 'espn', region: null, quality: null });
    expect(channelKey('ESPN 4K').quality).toBe('uhd');
    expect(channelKey('ESPN 480p').quality).toBe('sd');
  });

  it('keeps names in other scripts', () => {
    expect(channelKey('AR: الجزيرة HD').key).toBe('الجزيرة');
  });

  it('a name of tags only has nothing left', () => {
    expect(channelKey('HD').key).toBe('');
    expect(channelKey('').key).toBe('');
  });
});

describe('findSameChannel: matches', () => {
  it('the same channel under another provider\'s decoration', () => {
    expect(find('US: ESPN FHD', ['ESPN 2', 'USA | ESPN HD', 'ESPNU'])).toBe('USA | ESPN HD');
    expect(find('|US| ESPN2', ['ESPN', 'US: ESPN 2 HD'])).toBe('US: ESPN 2 HD');
    expect(find('ABC East', ['ABC West', '[US] ABC East'])).toBe('[US] ABC East');
    expect(find('Channel 4 +1', ['Channel 4', 'UK: Channel 4+1'])).toBe('UK: Channel 4+1');
  });

  it('prefers the failed one\'s own quality, then HD over SD', () => {
    expect(find('ESPN FHD', ['ESPN SD', 'ESPN HD', 'ESPN FHD', 'ESPN'])).toBe('ESPN FHD');
    expect(find('ESPN HD', ['ESPN SD', 'ESPN FHD', 'ESPN'])).toBe('ESPN FHD');
    expect(find('ESPN SD', ['ESPN HD', 'ESPN SD'])).toBe('ESPN SD');
    expect(find('ESPN ᴴᴰ', ['ESPN SD', 'ESPN'])).toBe('ESPN');
    expect(find('ESPN', ['ESPN SD', 'ESPN HD'])).toBe('ESPN HD');
    expect(find('ESPN', ['ESPN SD', 'ESPN'])).toBe('ESPN');
  });

  it('the same guide id under a different name', () => {
    expect(find({ name: 'FS1', epg_channel_id: 'FoxSports1.us' }, [ch('Fox Sports 2', 'foxsports2.us'), ch('Fox Sports 1 HD', 'foxsports1.us')])).toBe('Fox Sports 1 HD');
  });

  it('a name match wins over a guide-id one', () => {
    expect(find({ name: 'ESPN', epg_channel_id: 'espn.us' }, [ch('ESPN Deportes', 'espn.us'), ch('US: ESPN', 'other')])).toBe('US: ESPN');
  });

  it('leaves out what the caller skips', () => {
    const list = [ch('ESPN HD'), ch('ESPN SD')];
    const hit = findSameChannel({ name: 'ESPN' }, list, { skip: (c) => c.name === 'ESPN HD' });
    expect(hit?.name).toBe('ESPN SD');
  });

  it('a language tag does not clash with a country', () => {
    expect(find('EN| CNN', ['US: CNN'])).toBe('US: CNN');
  });
});

describe('findSameChannel: no match rather than a guess', () => {
  it.each([
    ['ESPN', ['ESPN 2', 'ESPNU', 'ESPN News']],
    ['ESPN 2', ['ESPN', 'ESPN 3']],
    ['FOX', ['FOX Sports 1', 'FOX News']],
    ['CNN', ['CNN International', 'HLN']],
    ['ABC East', ['ABC West', 'ABC']],
    ['ABC West', ['ABC East']],
    ['Channel 4', ['Channel 4 +1']],
    ['ESPN', ['ESPN+']],
    ['ESPN', ['ESPN Backup 2 Deportes']],
    ['Sky Sports Main Event', ['Sky Sports Premier League']],
  ])('%s is not in %j', (want, list) => {
    expect(find(want, list)).toBeNull();
  });

  it('ESPN Backup 2 is not ESPN 2', () => {
    expect(find('ESPN Backup 2', ['ESPN 2'])).toBeNull();
    expect(find('ESPN 2', ['ESPN Backup 2'])).toBeNull();
  });

  it('never across clashing countries', () => {
    expect(find('US: Discovery', ['UK: Discovery'])).toBeNull();
    expect(find('CA: CTV', ['US| CTV'])).toBeNull();
  });

  it('a guide id does not join East and West, numbered feeds or "International"', () => {
    expect(find({ name: 'ABC East', epg_channel_id: 'abc.us' }, [ch('ABC West', 'abc.us')])).toBeNull();
    expect(find({ name: 'ESPN', epg_channel_id: 'espn.us' }, [ch('ESPN 2', 'espn.us')])).toBeNull();
    expect(find({ name: 'CNN', epg_channel_id: 'cnn.us' }, [ch('CNN International', 'cnn.us')])).toBeNull();
    expect(find({ name: 'Channel 4', epg_channel_id: 'c4.uk' }, [ch('Channel 4 +1', 'c4.uk')])).toBeNull();
  });

  it('a guide id shared by many different channels is a placeholder', () => {
    const list = [ch('Sky Sports Main Event', 'sky.uk'), ch('Sky Sports Football', 'sky.uk'), ch('Sky Cinema', 'sky.uk')];
    expect(find({ name: 'Sky Sp Main Ev', epg_channel_id: 'sky.uk' }, list)).toBeNull();
  });

  it('empty or placeholder guide ids match nothing', () => {
    expect(find({ name: 'Movies One', epg_channel_id: '' }, [ch('Sports Two', '')])).toBeNull();
    expect(find({ name: 'Movies One', epg_channel_id: 'none' }, [ch('Sports Two', 'none')])).toBeNull();
    expect(find({ name: 'Movies One', epg_channel_id: '0' }, [ch('Sports Two', '0')])).toBeNull();
  });

  it('a name of tags only matches nothing by name', () => {
    expect(find('HD', ['SD', 'FHD', 'HD'])).toBeNull();
    expect(find('', ['ESPN'])).toBeNull();
  });

  it('an empty list, or rows without names', () => {
    expect(find('ESPN', [])).toBeNull();
    expect(findSameChannel({ name: 'ESPN' }, [{ stream_id: 1 } as unknown as Ch, null as unknown as Ch])).toBeNull();
  });
});

describe('findSameChannel: a full line-up', () => {
  it('finds one channel among tens of thousands quickly', () => {
    const list: Ch[] = [];
    for (let i = 0; i < 30000; i++) list.push(ch(`US: Channel ${i} HD`));
    list.push(ch('US| ESPN ᴴᴰ'));
    const t0 = performance.now();
    expect(find('ESPN FHD', list)).toBe('US| ESPN ᴴᴰ');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
