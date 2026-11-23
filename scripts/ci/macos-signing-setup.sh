#!/usr/bin/env bash
# Prepares a GitHub Actions macOS runner for Developer ID signing and notarization.
#
# Reads from the environment (GitHub secrets):
#   MACOS_CERT_P12       base64 of the exported "Developer ID Application" .p12
#   MACOS_CERT_PASSWORD  password of the .p12
#   APPLE_API_KEY_P8     base64 of the App Store Connect API key (.p8)
#
# Writes to $GITHUB_ENV:
#   SIGNING_KEYCHAIN            temporary keychain holding the certificate
#   ELECTROBUN_APPLEAPIKEYPATH  path of the decoded .p8 (also used by notarytool for the CLI)
#
# Clean up with scripts/ci/macos-signing-cleanup.sh (run it with `if: always()`).
set -euo pipefail

: "${MACOS_CERT_P12:?missing secret MACOS_CERT_P12}"
: "${MACOS_CERT_PASSWORD:?missing secret MACOS_CERT_PASSWORD}"
: "${APPLE_API_KEY_P8:?missing secret APPLE_API_KEY_P8}"

KEYCHAIN="$RUNNER_TEMP/signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -base64 24)"
CERT_PATH="$RUNNER_TEMP/developer-id.p12"
API_KEY_PATH="$RUNNER_TEMP/AuthKey.p8"

echo "$MACOS_CERT_P12" | base64 --decode > "$CERT_PATH"
echo "$APPLE_API_KEY_P8" | base64 --decode > "$API_KEY_PATH"
chmod 600 "$CERT_PATH" "$API_KEY_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$CERT_PATH" -P "$MACOS_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" > /dev/null
# Put the temporary keychain first in the search list, keeping the existing ones.
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
rm -f "$CERT_PATH"

security find-identity -v -p codesigning "$KEYCHAIN"

{
	echo "SIGNING_KEYCHAIN=$KEYCHAIN"
	echo "ELECTROBUN_APPLEAPIKEYPATH=$API_KEY_PATH"
} >> "$GITHUB_ENV"
