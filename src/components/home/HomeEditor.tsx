// What the Home editor draws (state and keys: useHomeEditor).
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { tileDef, type TileDest } from '@/lib/homeTiles';
import { BAR_SHOWS, BAR_SHOW_KEYS, BAR_SOURCES, BAR_SOURCE_KEYS, chooseBarShow, chooseBarSource } from '@/lib/homeBar';
import { TILE_BG, TILE_ICONS } from './tileVisuals';
import { BAR_MENU_ROWS, PICKER_COLS, TILE_MENU_ROWS, type Anchor, type BarMenuRow, type HomeEditor, type TileMenuRow } from './useHomeEditor';

// ── what is drawn ──────────────────────────────────────────────────────────

const MENU_BOX = 'fixed z-[90] rounded-2xl border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.7)] p-2 text-white font-nunito';
const ROW = 'tv-ring w-full text-left rounded-xl px-4 py-2.5 text-base font-semibold transition-colors duration-100';

/** The How-to guide's hooks on a tile's menu (data-howto; literals, so its check finds them). */
const TILE_HOWTO: Partial<Record<TileMenuRow, string>> = { move: 'home.tileMove', change: 'home.tileChange', reset: 'home.tileReset' };

const MENU_W = 300;
// Solid (no see-through: the bar's posters behind it read as noise on a TV).
const MENU_BG = 'rgb(15, 23, 42)';
const menuStyle = (a: Anchor | null): CSSProperties => {
  if (!a) return { left: '50%', top: '40%', transform: 'translate(-50%, -50%)', width: MENU_W, backgroundColor: MENU_BG };
  // Kept on screen at the row's ends.
  const half = MENU_W / 2;
  const x = Math.max(half + 8, Math.min(window.innerWidth - half - 8, a.x));
  return { left: x - half, bottom: a.bottom, width: MENU_W, backgroundColor: MENU_BG };
};

/** The tile being moved: lifted in gold over the card, with its arrows (tap
 *  them on a touch screen) and, there, Done. Drawn over the tile so the
 *  card itself is not drawn anew (MovingFavoriteMark's way). No flex gap. */
export const MovingTileMark = ({ editor, touch }: { editor: HomeEditor; touch: boolean }) => {
  const { t } = useTranslation();
  const arrow = 'pointer-events-auto rounded-lg bg-brand-gold text-black font-bold leading-none px-3 py-2 text-lg shadow-lg';
  return (
    <div
      data-tile-moving
      className="pointer-events-none absolute z-30 rounded-3xl bg-brand-gold/20 shadow-[0_10px_28px_rgba(0,0,0,0.65)]"
      style={{ top: -6, left: -6, right: -6, bottom: -6, boxShadow: 'inset 0 0 0 4px hsl(var(--brand-gold)), 0 10px 28px rgba(0,0,0,0.65)' }}
    >
      <div className="absolute left-0 right-0 flex items-center justify-center" style={{ top: -22 }}>
        <button type="button" aria-label={t('homeEdit.move.leftLabel')} className={arrow} onClick={() => editor.moveBy(-1)}>◀</button>
        {touch ? (
          <button type="button" className="pointer-events-auto mx-2 rounded-lg bg-white text-black font-bold px-3 py-2 text-sm shadow-lg" onClick={editor.drop}>
            {t('homeEdit.move.doneBtn')}
          </button>
        ) : <span className="mx-2" />}
        <button type="button" aria-label={t('homeEdit.move.rightLabel')} className={arrow} onClick={() => editor.moveBy(1)}>▶</button>
      </div>
    </div>
  );
};

/** The hint under the row while a tile is lifted. */
export const MoveHint = ({ touch }: { touch: boolean }) => {
  const { t } = useTranslation();
  return (
    // Under the row, in its own line (laid over the row, the lifted tile covered it).
    <div data-tile-move-hint className="text-center text-sm font-semibold text-brand-ice/90 font-nunito pointer-events-none" style={{ marginTop: 6 }}>
      {touch ? t('homeEdit.move.hintTouch') : t('homeEdit.move.hintRemote')}
    </div>
  );
};

const HomeEditorLayer = ({ editor }: { editor: HomeEditor }) => {
  const { t } = useTranslation();
  const s = editor.state;
  if (!s || s.kind === 'move') return null;

  if (s.kind === 'tileMenu' || s.kind === 'barMenu') {
    const tile = s.kind === 'tileMenu';
    const rows: readonly string[] = tile ? TILE_MENU_ROWS : BAR_MENU_ROWS;
    const label = (r: string) => t(tile ? `homeEdit.tileMenu.${r}Btn` : `homeEdit.bar.${r}Btn`);
    const title = tile ? t(tileDef(editor.previewRow?.[s.slot] ?? currentDest(editor, s.slot)).titleKey) : t('homeEdit.bar.menuTitle');
    return (
      <>
        <div className="fixed inset-0 z-[89]" onClick={editor.stepBack} aria-hidden="true" />
        <div role="dialog" aria-modal="true" aria-label={title} data-home-edit-menu={tile ? 'tile' : 'bar'} data-howto={tile ? 'home.tileMenu' : undefined} className={MENU_BOX} style={menuStyle(s.anchor)}>
          <div className="px-3 pt-1 pb-2 text-sm font-bold uppercase tracking-wider text-brand-gold truncate">{title}</div>
          {rows.map((r, i) => (
            <button
              key={r}
              type="button"
              data-menu-row={r}
              data-howto={tile ? TILE_HOWTO[r as TileMenuRow] : undefined}
              data-focused={s.focus === i ? 'true' : 'false'}
              className={`${ROW} ${s.focus === i ? 'bg-white/15' : 'hover:bg-white/10'} ${i > 0 ? 'mt-1' : ''}`}
              onClick={() => (tile ? editor.pressTileMenu(r as TileMenuRow) : editor.pressBarMenu(r as BarMenuRow))}
            >
              {label(r)}
            </button>
          ))}
        </div>
      </>
    );
  }

  if (s.kind === 'picker') {
    const row = currentRow(editor);
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70" onClick={editor.stepBack}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('homeEdit.picker.title')}
          data-home-edit-picker
          className="rounded-3xl border border-white/15 shadow-2xl p-6 text-white font-nunito"
          style={{ width: '88vw', maxWidth: 1180, backgroundColor: MENU_BG }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-2xl font-bold font-quicksand">{t('homeEdit.picker.title')}</h2>
          <p className="text-white/70 text-base mt-1 mb-4">{t('homeEdit.picker.subtitle')}</p>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${PICKER_COLS}, minmax(0, 1fr))`, gridGap: 12 }}>
            {editor.pickable.map((d, i) => {
              const Icon = TILE_ICONS[d.id];
              const here = row[s.slot] === d.id;
              const elsewhere = !here && row.includes(d.id);
              const focused = s.focus === i;
              return (
                <button
                  key={d.id}
                  type="button"
                  data-pick={d.id}
                  data-focused={focused ? 'true' : 'false'}
                  onClick={() => editor.pickTile(s.slot, d.id)}
                  className={`home-focus-surface relative rounded-2xl text-center px-2 pb-3 ${TILE_BG[d.color]}`}
                  style={{ paddingTop: 26 }}
                >
                  <Icon className="mx-auto w-8 h-8 text-white drop-shadow" />
                  <div className="mt-1.5 text-sm font-bold text-white leading-tight text-shadow-strong line-clamp-2">{t(d.titleKey)}</div>
                  {here && <Check className="absolute top-1.5 right-1.5 w-5 h-5 text-white" aria-label={t('homeEdit.picker.thisTileLabel')} />}
                  {elsewhere && (
                    <span className="absolute top-1.5 left-1.5 rounded-md bg-black/55 text-white text-[10px] font-bold tracking-wider px-1.5 py-0.5">
                      {t('homeEdit.picker.onHomeChip')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-white/55 text-sm mt-4">{t('homeEdit.picker.backHint')}</p>
        </div>
      </div>
    );
  }

  // Customize the content bar.
  const sp = s.spot;
  const chip = (focused: boolean, chosen: boolean) =>
    `tv-ring w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-base font-semibold border ${chosen ? 'bg-brand-gold/20 border-brand-gold' : 'bg-slate-800/70 border-white/15'} ${focused ? 'ring-2 ring-brand-gold scale-[1.02]' : ''}`;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70" onClick={editor.close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('homeEdit.bar.customizeTitle')}
        data-home-edit-customize
        className="rounded-3xl border border-white/15 shadow-2xl p-6 text-white font-nunito"
        style={{ width: '70vw', maxWidth: 820, backgroundColor: MENU_BG }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold font-quicksand">{t('homeEdit.bar.customizeTitle')}</h2>
        <p className="text-white/70 text-base mt-1 mb-4">{t('homeEdit.bar.customizeSubtitle')}</p>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gridGap: 20 }}>
          <div>
            <div className="text-sm font-bold uppercase tracking-wider text-brand-gold mb-2">{t('homeEdit.bar.sourceTitle')}</div>
            {BAR_SOURCES.map((src, i) => (
              <button
                key={src}
                type="button"
                data-bar-source={src}
                data-focused={sp.col === 0 && sp.i === i ? 'true' : 'false'}
                className={`${chip(sp.col === 0 && sp.i === i, editor.barSource === src)} ${i > 0 ? 'mt-2' : ''}`}
                onClick={() => chooseBarSource(src)}
              >
                <span>{t(BAR_SOURCE_KEYS[src])}</span>
                {editor.barSource === src && <Check className="w-5 h-5 text-brand-gold" />}
              </button>
            ))}
          </div>
          <div>
            <div className="text-sm font-bold uppercase tracking-wider text-brand-gold mb-2">{t('homeEdit.bar.showTitle')}</div>
            {BAR_SHOWS.map((sh, i) => (
              <button
                key={sh}
                type="button"
                data-bar-show={sh}
                data-focused={sp.col === 1 && sp.i === i ? 'true' : 'false'}
                className={`${chip(sp.col === 1 && sp.i === i, editor.barShow === sh)} ${i > 0 ? 'mt-2' : ''}`}
                onClick={() => chooseBarShow(sh)}
              >
                <span>{t(BAR_SHOW_KEYS[sh])}</span>
                {editor.barShow === sh && <Check className="w-5 h-5 text-brand-gold" />}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          data-bar-done
          data-focused={sp.col === 2 ? 'true' : 'false'}
          onClick={editor.close}
          className={`tv-ring mt-5 w-full rounded-xl px-4 py-3 text-base font-bold bg-brand-gold text-black ${sp.col === 2 ? 'ring-2 ring-white scale-[1.01]' : ''}`}
        >
          {t('homeEdit.bar.doneBtn')}
        </button>
      </div>
    </div>
  );
};

const currentRow = (editor: HomeEditor): TileDest[] => editor.rowForDraw;
const currentDest = (editor: HomeEditor, slot: number): TileDest => editor.rowForDraw[slot];

export default HomeEditorLayer;
