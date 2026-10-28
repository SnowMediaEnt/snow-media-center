import { describe, expect, it } from 'vitest';
import { buildSeriesIndex, castNames, cleanTitle, findFranchise, findMoreLikeThis, franchiseKey, sequelNumber, seriesIndexReady } from './vodRelated';

let id = 0;
const film = (name: string, extra: Partial<{ stream_icon: string; year: string; category_id: string; genre: string; stream_id: number }> = {}) =>
  ({ stream_id: ++id, name, category_id: '5', ...extra });

describe('cleanTitle', () => {
  it('strips provider prefixes, tags, brackets and the year', () => {
    expect(cleanTitle('EN - Doll Night (1988)')).toEqual({ base: 'doll night', year: 1988, yearFromTail: false });
    expect(cleanTitle('|EN| Doll Night [4K]').base).toBe('doll night');
    expect(cleanTitle('4K-Doll Night').base).toBe('doll night');
    expect(cleanTitle('[MULTI] UHD | Doll Night 1080p HEVC').base).toBe('doll night');
    expect(cleanTitle('FR: Doll Night - 1990')).toEqual({ base: 'doll night', year: 1990, yearFromTail: true });
    expect(cleanTitle('Doll Night 1991')).toEqual({ base: 'doll night', year: 1991, yearFromTail: true });
  });
  it('keeps a title that is only a year', () => {
    expect(cleanTitle('1917').base).toBe('1917');
  });
  it('folds apostrophes, accents and & ', () => {
    expect(cleanTitle("Kid’s Toy & Doll").base).toBe('kids toy and doll');
    expect(cleanTitle('Café Noir').base).toBe('cafe noir');
  });
});

describe('franchiseKey', () => {
  it('gives the first film and its numbered sequels one key', () => {
    const k = franchiseKey("Doll's Night");
    expect(k).toBe('dolls night');
    for (const n of ["Doll's Night 2", "Doll's Night 3", "Doll's Night II", "Doll's Night III", "EN - Doll's Night 2 (1990)", "|EN| Doll's Night 3 [HD]"]) {
      expect(franchiseKey(n)).toBe(k);
    }
  });
  it('reads Part / Chapter, roman numerals and subtitles after the number', () => {
    const k = franchiseKey('Harbor Lights');
    expect(franchiseKey('Harbor Lights Part 2')).toBe(k);
    expect(franchiseKey('Harbor Lights: Part Two')).toBe(k);
    expect(franchiseKey('Harbor Lights - Chapter IV')).toBe(k);
    expect(franchiseKey('Harbor Lights 2: The Return')).toBe(k);
    expect(franchiseKey('Harbor Lights 3 - Last Tide')).toBe(k);
    expect(franchiseKey('Harbor Lights V')).toBe(k);
    expect(franchiseKey('Harbor Lights 2 Deep Water')).toBe(k);
    expect(franchiseKey('Harbor Lights: Deep Water')).toBe(k);
    expect(franchiseKey('The Harbor Lights 4')).toBe(k);
  });
  it('leaves spin-offs with another stem alone', () => {
    expect(franchiseKey('Curse of the Harbor Lights')).not.toBe(franchiseKey('Harbor Lights'));
  });
  it('gives no key to short or common stems', () => {
    expect(franchiseKey('Up 2')).toBe('');
    expect(franchiseKey('Love')).toBe('');
    expect(franchiseKey('Home 2')).toBe('');
    expect(franchiseKey('The Love')).toBe('');
    expect(franchiseKey('EN - Night II')).toBe('');
    expect(franchiseKey('Ice')).toBe('');
    expect(franchiseKey('1917')).toBe('');
  });
  it('a number past 19 is part of the title, not a sequel', () => {
    expect(franchiseKey('Station 42')).toBe('station 42');
  });
});

describe('sequelNumber', () => {
  it('reads digits, roman numerals and words after Part', () => {
    expect(sequelNumber('Doll Night')).toBeNull();
    expect(sequelNumber('Doll Night 2')).toBe(2);
    expect(sequelNumber('Doll Night III (1991)')).toBe(3);
    expect(sequelNumber('Doll Night Part Four')).toBe(4);
    expect(sequelNumber('Doll Night 5: Reborn')).toBe(5);
  });
});

describe('findFranchise', () => {
  it('lists the series in order, without the film itself', () => {
    const cur = film('EN - Doll Night 2 (1990)');
    const all = [
      film('Doll Night 3 (1991)'), film('Sea Glass'), cur, film('Doll Night (1988)'),
      film('Doll Night 4: Bride'), film('Curse of the Doll'), film('Doll Night II Remix', { year: '2005' }),
    ];
    expect(findFranchise(cur, all).map((m) => m.name)).toEqual([
      'Doll Night (1988)', 'Doll Night 3 (1991)', 'Doll Night 4: Bride',
    ]);
  });
  it('keeps one copy per title, the one with a poster', () => {
    const cur = film('Doll Night');
    const a = film('EN - Doll Night 2');
    const b = film('Doll Night 2 [4K]', { stream_icon: 'http://img/2.jpg' });
    const c = film('|EN| Doll Night 2 (1990)');
    const out = findFranchise(cur, [cur, a, b, c]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(b);
  });
  it('drops other copies of the open film', () => {
    const cur = film('Doll Night 2');
    const copy = film('EN - Doll Night 2 [HD]');
    expect(findFranchise(cur, [cur, copy, film('Doll Night 3')]).map((m) => m.name)).toEqual(['Doll Night 3']);
  });
  it('keeps two films of one title from different years (a remake)', () => {
    const cur = film('Doll Night 2');
    const out = findFranchise(cur, [cur, film('Doll Night (1988)'), film('Doll Night (2019)')]);
    expect(out.map((m) => m.name)).toEqual(['Doll Night (1988)', 'Doll Night (2019)']);
  });
  it('gives nothing for a common stem or an empty list', () => {
    const cur = film('Love 2');
    expect(findFranchise(cur, [cur, film('Love'), film('Love 3')])).toEqual([]);
    expect(findFranchise(film('Doll Night'), [])).toEqual([]);
    expect(findFranchise(film('Doll Night'), null)).toEqual([]);
  });
  it('re-reads a list it has already indexed', () => {
    const cur = film('Doll Night');
    const all = [cur, film('Doll Night 2')];
    expect(findFranchise(cur, all)).toHaveLength(1);
    expect(findFranchise(all[1], all).map((m) => m.name)).toEqual(['Doll Night']);
  });
});

describe('findMoreLikeThis', () => {
  it('takes the films after it in its category, never its series or itself', () => {
    const cur = film('Doll Night');
    const list = [film('A Film'), cur, film('Doll Night 2'), film('B Film'), film('C Film')];
    expect(findMoreLikeThis(cur, list).map((m) => m.name)).toEqual(['B Film', 'C Film', 'A Film']);
  });
  it('puts films sharing a genre first', () => {
    const cur = film('Sea Glass');
    const list = [cur, film('Dry Comedy', { genre: 'Comedy' }), film('Fog Bank', { genre: 'Horror, Thriller' })];
    expect(findMoreLikeThis(cur, list, 'Thriller / Mystery').map((m) => m.name)).toEqual(['Fog Bank', 'Dry Comedy']);
  });
  it('skips excluded ids, copies, and stops at the limit', () => {
    const cur = film('Sea Glass');
    const skip = film('Rock Pool');
    const list = [cur, film('EN - Sea Glass [4K]'), skip, ...Array.from({ length: 20 }, (_, i) => film(`Title ${String.fromCharCode(65 + i)}`))];
    const out = findMoreLikeThis(cur, list, null, [skip.stream_id]);
    expect(out).toHaveLength(12);
    expect(out.find((m) => m.name.includes('Sea Glass') || m === skip)).toBeUndefined();
    expect(findMoreLikeThis(cur, list, null, [], 3)).toHaveLength(3);
  });
  it('works when the film is not in the list', () => {
    expect(findMoreLikeThis(film('Elsewhere'), [film('One Film'), film('Two Film')]).map((m) => m.name)).toEqual(['Two Film', 'One Film']);
  });
});

describe('castNames', () => {
  it('splits, trims, dedupes and caps', () => {
    expect(castNames(' Ann Lee, Bo Park ,ann lee,, Cy Dorn')).toEqual(['Ann Lee', 'Bo Park', 'Cy Dorn']);
    expect(castNames('a, b, c', 2)).toEqual(['a', 'b']);
    expect(castNames(undefined)).toEqual([]);
  });
});

describe('review cases (invented titles)', () => {
  const mk = (stream_id: number, name: string, year?: string) => ({ stream_id, name, year });

  it('a bare trailing 10-19 is a name unless the series has a first film', () => {
    const list = [mk(1, 'Orbit 11'), mk(2, 'Orbit 13'), mk(3, 'Orbit 18')];
    expect(findFranchise(list[1], list)).toEqual([]);
    const withFirst = [mk(4, 'Doll Night'), mk(5, 'Doll Night 2'), mk(6, 'Doll Night 3')];
    expect(findFranchise(withFirst[1], withFirst).map((m) => m.name)).toEqual(['Doll Night', 'Doll Night 3']);
  });

  it('a lone X is a name, not part 10', () => {
    expect(sequelNumber('Marcus X')).toBeNull();
  });

  it('a sequel named by a trailing year is not a copy of the first film', () => {
    const list = [mk(1, 'Glass Runner'), mk(2, 'Glass Runner 2049')];
    expect(findFranchise(list[0], list).map((m) => m.name)).toEqual(['Glass Runner 2049']);
    // A real copy with its year in brackets still folds into the plain one.
    const copies = [mk(3, 'Glass Runner'), mk(4, 'Glass Runner (1982)'), mk(5, 'Glass Runner 2')];
    expect(findFranchise(copies[2], copies)).toHaveLength(1);
  });

  it('never cuts a subtitle after a single word', () => {
    expect(franchiseKey('Quest: Unbroken')).toBe(franchiseKey('Quest: Unbroken 2'));
    expect(franchiseKey('Quest: Unbroken - Fallen Sky')).toBe(franchiseKey('Quest: Unbroken 2'));
    expect(franchiseKey('The Quest')).not.toBe(franchiseKey('Quest: Unbroken'));
    expect(franchiseKey('Sky Wars: Episode IV: A New Dawn')).toBe('sky wars');
  });

  it('builds a big index a slice at a time', async () => {
    const list = Array.from({ length: 4000 }, (_, i) => mk(i + 1, `Film Number ${i}`));
    list.push(mk(9001, 'Doll Night'), mk(9002, 'Doll Night 2'));
    expect(seriesIndexReady(list)).toBe(false);
    await buildSeriesIndex(list, 500);
    expect(seriesIndexReady(list)).toBe(true);
    expect(findFranchise(list[4000], list).map((m) => m.name)).toEqual(['Doll Night 2']);
  });
});
