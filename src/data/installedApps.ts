// Default installed apps for the device
export interface InstalledApp {
  id: string;
  name: string;
  icon: string;
  packageName: string;
}

export const defaultInstalledApps: InstalledApp[] = [
  {
    id: 'dreamstreams-3',
    name: 'Dreamstreams 3.0',
    icon: 'https://snowmediaapps.com/apps/icons/dreamstreams.png',
    packageName: 'com.dreamstreams.app',
  },
  {
    id: 'vibeztv',
    name: 'VibezTV',
    icon: 'https://snowmediaapps.com/apps/icons/vibeztv.png',
    packageName: 'com.vibeztv.app',
  },
  {
    id: 'plex',
    name: 'Plex',
    icon: 'https://snowmediaapps.com/apps/icons/plex.png',
    packageName: 'com.plexapp.android',
  },
  {
    id: 'ipvanish',
    name: 'IPVanish',
    icon: 'https://snowmediaapps.com/apps/icons/ipvanish.png',
    packageName: 'com.ixonn.ipvanish',
  },
  {
    id: 'downloader',
    name: 'Downloader',
    icon: 'https://snowmediaapps.com/apps/icons/downloader.png',
    packageName: 'com.esaba.downloader',
  },
  {
    id: 'xciptv',
    name: 'XCIPTV',
    icon: 'https://snowmediaapps.com/apps/icons/xciptv.png',
    packageName: 'com.xciptv.player',
  },
  {
    id: 'tivimate',
    name: 'TiviMate',
    icon: 'https://snowmediaapps.com/apps/icons/tivimate.png',
    packageName: 'ar.tvplayer.tv',
  },
];
