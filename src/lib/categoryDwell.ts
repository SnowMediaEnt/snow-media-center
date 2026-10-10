// How long the remote's highlight rests on a category before that category's
// channels are downloaded and shown, in Live TV's category list (and the
// channel list over the picture) and in the Guide's category bar.
//
// Owner, 2026-10-09: "channel listings don't load as I scroll thru
// categories, need to click OK button to load the channels, they should auto
// load after 1 sec (so they don't bother to load on a fast click past)".
// Passing over categories faster than this downloads nothing; OK (or ▶ / ▼
// into the list), a tap or a click on a category loads it at once.

/** The highlight's rest on a category before its channels load. */
export const CATEGORY_DWELL_MS = 1000;

/** A category whose list is kept already (xtream's live catalogue: no
 *  download) shows after this short settle instead of the full rest. It only
 *  keeps a held ▼ (or ◀ ▶ in the Guide) from drawing every kept list it
 *  passes. */
export const KEPT_CATEGORY_SETTLE_MS = 250;
