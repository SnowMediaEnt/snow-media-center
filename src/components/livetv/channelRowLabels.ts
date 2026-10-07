import type { TFunction } from 'i18next';

export interface ChannelRowLabels {
  live: string;
  onAir: string;
  down: string;
  downNote: string;
  categoryDown: string;
  categoryDownNote: string;
  buffering: string;
  bufferingNote: string;
  noInfo: string;
}

/** Translate the row's words. The list calls this once per language and hands the result to every row. */
export const channelRowLabels = (t: TFunction): ChannelRowLabels => ({
  live: t('live.channelRow.liveChip'),
  onAir: t('live.channelRow.onAirChip'),
  down: t('live.channelRow.downLabel'),
  downNote: t('live.channelRow.downNote'),
  categoryDown: t('live.channelRow.categoryDownLabel'),
  categoryDownNote: t('live.channelRow.categoryDownNote'),
  buffering: t('live.channelRow.bufferingLabel'),
  bufferingNote: t('live.channelRow.bufferingNote'),
  noInfo: t('live.channelRow.noInfo'),
});
