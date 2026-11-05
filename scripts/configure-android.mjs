#!/usr/bin/env node
// Patches the generated android/ project: version numbers and signing.
//   APP_VERSION_CODE=12 APP_VERSION_NAME=1.0.12 node scripts/configure-android.mjs
// Signing uses ANDROID_KEYSTORE_PATH / _PASSWORD / ANDROID_KEY_ALIAS / _PASSWORD
// when set, otherwise the committed debug key in android-keys/.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const gradlePath = path.join(process.env.ANDROID_PROJECT_DIR || path.join(ROOT, 'android'), 'app', 'build.gradle');
if (!fs.existsSync(gradlePath)) throw new Error('android/app/build.gradle not found. Run: npx cap add android');
let g = fs.readFileSync(gradlePath, 'utf8');

const code = Math.max(1, parseInt(process.env.APP_VERSION_CODE || '1', 10));
const name = (process.env.APP_VERSION_NAME || '1.0.0').replace(/[^0-9A-Za-z.\-+]/g, '');
g = g.replace(/versionCode\s+\d+/, `versionCode ${code}`).replace(/versionName\s+"[^"]*"/, `versionName "${name}"`);

if (!g.includes('// appforge-signing')) {
  const signing = `
    // appforge-signing
    signingConfigs {
        debug {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "${path.join(ROOT, 'android-keys', 'debug.keystore').replace(/\\/g, '/')}")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: "android"
            keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: "androiddebugkey"
            keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: "android"
        }
    }
`;
  if (!/\n\s*buildTypes\s*\{/.test(g)) throw new Error('buildTypes block not found in build.gradle');
  g = g.replace(/(\n\s*buildTypes\s*\{)/, `${signing}$1`);
}
fs.writeFileSync(gradlePath, g);
console.log(`android configured: versionCode ${code}, versionName ${name}`);
