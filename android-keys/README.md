# Debug signing key

`debug.keystore` signs the APK that GitHub Actions builds for sideloading
(password `android`, alias `androiddebugkey`). It is committed on purpose:
every build is signed with the same key, so a new APK installs over the old
one and the app keeps its saved keys and profiles.

Because the repo is public, anyone can sign an APK with this key. Only install
APKs from this repo's own Releases page. For a build you give to other people
or publish to the Play Store, add your own key as repository secrets
(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`) and the workflow uses it instead.
