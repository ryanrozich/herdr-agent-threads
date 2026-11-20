#!/bin/sh
# Installs one pinned Herdr release for test/herdr-still.sh, as the install-herdr setup step in
# .catalyst/catalyst.toml: the Linux app and core archives straight from the release server,
# each checked against the sha256 written below before anything is unpacked or run. No
# installer script is fetched. It goes into HERDR_RIG, by default .herdr-rig in this checkout
# (ignored by git), because a setup step's home does not reach the session that follows.
# It prints one line starting "install-herdr: Herdr did not install" and exits 1 when it does
# not install, and never waits on the network for more than the limits below.
# Moving the pin: one pull request that changes the two versions and the four checksums here,
# read from https://releases.herdr.dev/app/<version>/ and /core/<version>/ (each has a
# manifest with the sha256 of every archive), merged by a person.
set -u
APP_VERSION=0.1.16
CORE_VERSION=0.1.21
APP_SHA256_X86_64=282d2632196b238206cfe66bfb61c0faf299ca1c91843bd076521bbe36571216
APP_SHA256_AARCH64=efeef4f1759b0e8900f205c2c22b14287a112f874406539b4ea1b3be24b73631
CORE_SHA256_X86_64=78424755c10a40dde38a0bdb55c20ac19706e9ae05ed68fc2acf1fcff0d941c1
CORE_SHA256_AARCH64=e844a2bfab48a226097679d076bc83042fe57fccef5387ef802e5b24e78b529a
RELEASES=https://releases.herdr.dev

miss() { echo "install-herdr: Herdr did not install: $*" >&2; exit 1; }
cd "$(dirname "$0")/.." || miss "no checkout"
D=${HERDR_RIG:-$(pwd)/.herdr-rig}
[ "$(uname -s)" = Linux ] || miss "this installs the Linux build, and this is $(uname -s)"
case $(uname -m) in
  x86_64 | amd64) arch=x86_64 app_sha=$APP_SHA256_X86_64 core_sha=$CORE_SHA256_X86_64 ;;
  aarch64 | arm64) arch=aarch64 app_sha=$APP_SHA256_AARCH64 core_sha=$CORE_SHA256_AARCH64 ;;
  *) miss "no build for $(uname -m)" ;;
esac
for c in curl tar sha256sum; do command -v "$c" > /dev/null || miss "no $c"; done

T=$D/.download
rm -rf "$T"
mkdir -p "$T/x" || miss "cannot write $D"
trap 'rm -rf "$T"' EXIT
# A download goes to a file, so a failure is curl's own exit; each has a time limit.
fetch() { curl -fsSL --connect-timeout 20 --max-time "$3" -o "$2" "$1" || miss "download failed: $1"; }
check() { [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$2" ] || miss "checksum mismatch for $3 (the pin says $2)"; }
fetch "$RELEASES/app/$APP_VERSION/herdr-app-linux-$arch.tar.gz" "$T/app.tar.gz" 150
check "$T/app.tar.gz" "$app_sha" "herdr-app $APP_VERSION"
fetch "$RELEASES/core/$CORE_VERSION/herdr-core-linux-$arch.tar.gz" "$T/core.tar.gz" 60
check "$T/core.tar.gz" "$core_sha" "herdr-core $CORE_VERSION"
tar -xzf "$T/app.tar.gz" -C "$T/x" || miss "an archive did not unpack"
tar -xzf "$T/core.tar.gz" -C "$T/x" || miss "an archive did not unpack"
[ -f "$T/x/herdr-app/herdr-app" ] && [ -f "$T/x/herdr-core" ] || miss "the archives are not laid out as expected"

rm -rf "${D:?}/herdr-app" "${D:?}/bin"
mkdir -p "$D/bin" || miss "cannot write $D"
mv "$T/x/herdr-app" "$D/herdr-app" || miss "cannot write $D"
mv "$T/x/herdr-core" "$D/bin/herdr-core" || miss "cannot write $D"
chmod 755 "$D/herdr-app/herdr-app" "$D/bin/herdr-core"
ln -sfn ../herdr-app/herdr-app "$D/bin/herdr-app"
ln -sfn herdr-core "$D/bin/hc"
printf 'herdr-app %s\nherdr-core %s\n' "$APP_VERSION" "$CORE_VERSION" > "$D/VERSION"
echo "install-herdr: Herdr $APP_VERSION and core $CORE_VERSION ($arch) in $D" >&2
