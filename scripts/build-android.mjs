#!/usr/bin/env node
// Builds the Android APK. GitHub Actions runs this on every push; you can run
// it yourself with Android Studio's SDK installed (ANDROID_HOME set) and Java 21.
//   npm run android -- --version-code 12
// Output: dist-android/AppForge-Research.apk
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const versionCode = String(Math.max(1, parseInt(arg('version-code', process.env.APP_VERSION_CODE || '1'), 10)));
const versionName = arg('version-name', process.env.APP_VERSION_NAME || `1.0.${versionCode}`);
const run = (cmd, cwd = ROOT, env = {}) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
};

run(`node scripts/build-site.mjs --version ${versionName}`);
if (!fs.existsSync(path.join(ROOT, 'android'))) run('npx cap add android');
run("npx @capacitor/assets generate --android --iconBackgroundColor '#070d1a' --iconBackgroundColorDark '#070d1a' --splashBackgroundColor '#070d1a' --splashBackgroundColorDark '#070d1a'");
run('npx cap sync android');
run('node scripts/configure-android.mjs', ROOT, { APP_VERSION_CODE: versionCode, APP_VERSION_NAME: versionName });

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (process.platform !== 'win32') fs.chmodSync(path.join(ROOT, 'android', 'gradlew'), 0o755);
run(`${gradlew} assembleDebug --no-daemon ${process.env.GRADLE_ARGS || ''}`.trim(), path.join(ROOT, 'android'));

const apk = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const out = path.join(ROOT, 'dist-android', 'AppForge-Research.apk');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(apk, out);
console.log(`\n✔ ${path.relative(ROOT, out)} (version ${versionName}, code ${versionCode})`);
