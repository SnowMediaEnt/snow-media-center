import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.f44324110df840aea0a1fb97cafa76e7',
  appName: 'Snow Media Center',
  webDir: 'dist',
  // The bridge's default ('debug') logs every plugin call's arguments in a
  // debuggable build — including the billing password and gift codes sent
  // to SmcBilling. Off for everyone; our own native code logs what it needs.
  loggingBehavior: 'none',
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
      backgroundColor: '#071b3a',
      showSpinner: false
    }
  }
};

export default config;
