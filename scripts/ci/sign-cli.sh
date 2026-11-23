#!/usr/bin/env bash
# Signs the compiled TUI binary with the Developer ID certificate (hardened
# runtime) and notarizes it. A bare Mach-O cannot be stapled: Gatekeeper looks
# the ticket up online the first time the binary runs.
#
# Usage: scripts/ci/sign-cli.sh build-cli/ingombro
#
# Environment:
#   ELECTROBUN_DEVELOPER_ID      e.g. "Developer ID Application: dambox Sagl (CLFTJ6F63K)"
#   ELECTROBUN_APPLEAPIKEY       App Store Connect API Key ID
#   ELECTROBUN_APPLEAPIISSUER    App Store Connect API Issuer ID
#   ELECTROBUN_APPLEAPIKEYPATH   path of the .p8 key
#   SKIP_NOTARIZE=1              sign only (local checks)
set -euo pipefail

BINARY="${1:?usage: sign-cli.sh <binary>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
: "${ELECTROBUN_DEVELOPER_ID:?missing ELECTROBUN_DEVELOPER_ID}"

# cli-entitlements.plist: hardened runtime exceptions a `bun build --compile`
# binary needs (JIT, and the OpenTUI native library it loads at runtime).
# Keep it free of XML comments: codesign's entitlements parser rejects them.
codesign --force --timestamp --options runtime \
	--entitlements "$SCRIPT_DIR/cli-entitlements.plist" \
	--sign "$ELECTROBUN_DEVELOPER_ID" "$BINARY"
codesign --verify --strict --verbose=2 "$BINARY"

if [[ "${SKIP_NOTARIZE:-}" == "1" ]]; then
	echo "SKIP_NOTARIZE=1: signed, not notarized"
	exit 0
fi

: "${ELECTROBUN_APPLEAPIKEY:?missing ELECTROBUN_APPLEAPIKEY}"
: "${ELECTROBUN_APPLEAPIISSUER:?missing ELECTROBUN_APPLEAPIISSUER}"
: "${ELECTROBUN_APPLEAPIKEYPATH:?missing ELECTROBUN_APPLEAPIKEYPATH}"

ZIP="$(mktemp -d)/$(basename "$BINARY").zip"
ditto -c -k --keepParent "$BINARY" "$ZIP"

RESULT="$(xcrun notarytool submit "$ZIP" \
	--key "$ELECTROBUN_APPLEAPIKEYPATH" \
	--key-id "$ELECTROBUN_APPLEAPIKEY" \
	--issuer "$ELECTROBUN_APPLEAPIISSUER" \
	--wait --output-format json)"
rm -f "$ZIP"
echo "$RESULT"

STATUS="$(echo "$RESULT" | /usr/bin/plutil -extract status raw -o - -)"
if [[ "$STATUS" != "Accepted" ]]; then
	ID="$(echo "$RESULT" | /usr/bin/plutil -extract id raw -o - -)"
	xcrun notarytool log "$ID" \
		--key "$ELECTROBUN_APPLEAPIKEYPATH" \
		--key-id "$ELECTROBUN_APPLEAPIKEY" \
		--issuer "$ELECTROBUN_APPLEAPIISSUER" || true
	echo "Notarization failed: $STATUS" >&2
	exit 1
fi
echo "Notarized: $BINARY"
