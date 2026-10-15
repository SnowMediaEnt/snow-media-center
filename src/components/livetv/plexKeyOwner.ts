// Exactly ONE UI layer owns the D-pad at a time: the browse panels, the
// detail overlay, or the player. The owner is set SYNCHRONOUSLY in the same
// call that triggers the layer change — never from an effect — so there is
// no window (the layout→passive-effect gap) where two capture-phase keydown
// listeners both act on the same key. Every browse-side handler must bail on
// its first line when it is not the owner; prop-level gating (isActive) is
// only defence in depth because listener teardown waits for passive effects.
// 'menu': a poster's hold menu (PlexRecommendMenu) over the rails or the
// title page; plexRecommendHold takes it and gives it back.
export type PlexKeyOwner = 'browse' | 'detail' | 'player' | 'menu';

let owner: PlexKeyOwner = 'browse';

export const setPlexKeyOwner = (o: PlexKeyOwner): void => { owner = o; };
export const getPlexKeyOwner = (): PlexKeyOwner => owner;
export const isPlexKeyOwner = (o: PlexKeyOwner): boolean => owner === o;
