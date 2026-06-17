import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.f44324110df840aea0a1fb97cafa76e7',
  appName: 'Snow Media Center',
  webDir: 'dist',
  android: {
    // Streams are http:// while the WebView origin is https://localhost.
    // Without this, Chromium blocks the video/HLS request as Mixed Content
    // and the player silently fails. Takes effect after `cap sync android`
    // + APK rebuild.
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1e293b',
      showSpinner: false
    }
  }
};

export default config;
