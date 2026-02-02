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
    icon: '/icons/dreamstreams.png',
    packageName: 'com.dreamstreams.app',
  },
  {
    id: 'vibeztv',
    name: 'VibezTV',
    icon: '/icons/vibeztv.png',
    packageName: 'com.vibeztv.app',
  },
  {
    id: 'plex',
    name: 'Plex',
    icon: '/icons/plex.png',
    packageName: 'com.plexapp.android',
  },
  {
    id: 'ipvanish',
    name: 'IPVanish',
    icon: '/icons/ipvanish.png',
    packageName: 'com.ixonn.ipvanish',
  },
  {
    id: 'downloader',
    name: 'Downloader',
    icon: '/icons/downloader.png',
    packageName: 'com.esaba.downloader',
  },
];
