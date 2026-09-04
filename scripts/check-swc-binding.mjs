// Verifies that @swc/core's native binding actually loads, and if it does not,
// says exactly how to fix it.
//
// WHY: `@vitejs/plugin-react-swc` needs a platform-specific binary that ships as
// an OPTIONAL dependency (@swc/core-darwin-arm64, -linux-x64-gnu, …). npm skips
// optional deps in a number of ordinary situations — most commonly when it does
// an INCREMENTAL install over an existing node_modules ("changed N packages"
// rather than "added N packages"), which is what happens when you unzip a new
// copy of the repo over an old one, or re-run npm install in place.
//
// When the binary is missing, the only symptom is this, at build time:
//
//   failed to load config from vite.config.ts
//   error during build:
//   Error: Failed to load native binding
//
// which names neither the package nor the cause. This turns that into an
// actionable message at INSTALL time instead. It never fails the install.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const expectedPackage = () => {
  const { platform, arch } = process;
  if (platform === 'darwin') return `@swc/core-darwin-${arch}`;
  if (platform === 'win32') return `@swc/core-win32-${arch}-msvc`;
  if (platform === 'linux') {
    // musl (Alpine) vs glibc — report.header is the reliable probe.
    let musl = false;
    try { musl = (process.report?.getReport()?.header?.glibcVersionRuntime) == null; } catch { /* ignore */ }
    return `@swc/core-linux-${arch}-${musl ? 'musl' : 'gnu'}`;
  }
  return `@swc/core-${platform}-${arch}`;
};

try {
  require.resolve('@swc/core');
} catch {
  process.exit(0); // @swc/core itself isn't installed yet — not our problem
}

try {
  require('@swc/core');
  process.exit(0); // binding loaded, nothing to do
} catch (err) {
  const msg = String(err?.message || err);
  if (!/native binding|Cannot find module/i.test(msg)) process.exit(0);

  const pkg = expectedPackage();
  console.error(`
┌──────────────────────────────────────────────────────────────────────────┐
│  @swc/core cannot load its native binding — \`npm run build\` WILL FAIL    │
└──────────────────────────────────────────────────────────────────────────┘
  Missing platform package:  ${pkg}
  Detected:                  ${process.platform}/${process.arch}, Node ${process.version}

  npm skipped this optional dependency. That happens on an INCREMENTAL install
  over an existing node_modules — note whether npm said "changed N packages"
  instead of "added N packages".

  Fix (from the project root):

      rm -rf node_modules
      npm install

  If that still fails, install the binary directly:

      npm install --no-save ${pkg}
`);
  process.exit(0); // never break npm install
}
