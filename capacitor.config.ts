import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.f44324110df840aea0a1fb97cafa76e7',
  appName: 'snow-tv-hub-center',
  webDir: 'dist',
  server: {
    url: "https://f4432411-0df8-40ae-a0a1-fb97cafa76e7.lovableproject.com?forceHideBadge=true",
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1e293b',
      showSpinner: false
    },
    App: {
      launchUrl: "https://f4432411-0df8-40ae-a0a1-fb97cafa76e7.lovableproject.com?forceHideBadge=true"
    }
  }
};

export default config;