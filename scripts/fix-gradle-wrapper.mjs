// Repairs the Capacitor/Lovable stub gradle-wrapper.jar so `./gradlew` works.
// Runs on postinstall; safe no-op when there's no android/ or no system gradle
// (e.g. the Lovable web sandbox, or when the wrapper is already valid).
import { existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

const jar = 'android/gradle/wrapper/gradle-wrapper.jar';
try {
  if (!existsSync('android')) process.exit(0);                       // no native project here
  if (existsSync(jar) && statSync(jar).size > 10000) process.exit(0); // wrapper already valid
  try { execSync('gradle --version', { stdio: 'ignore' }); }         // need a system gradle to regen
  catch { process.exit(0); }                                         // none → skip (Android Studio still builds)
  execSync('gradle wrapper --gradle-version 8.6 --distribution-type bin', { cwd: 'android', stdio: 'ignore' });
  console.log('[fix-gradle-wrapper] regenerated Gradle 8.6 wrapper');
} catch {
  /* never break npm install */
}