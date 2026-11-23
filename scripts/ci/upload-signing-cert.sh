#!/usr/bin/env bash
# Exports the Developer ID identity from the login keychain and uploads it to
# the MACOS_CERT_P12 GitHub secret, then deletes the exported file.
#
# Use the same .p12 password stored in the MACOS_CERT_PASSWORD secret (if you
# pick a new one, run `gh secret set MACOS_CERT_PASSWORD` afterwards).
# Run it again whenever the certificate is renewed.
set -euo pipefail

P12="$(mktemp -d)/developer-id.p12"
trap 'rm -f "$P12"' EXIT

echo "Exporting the Developer ID identity (macOS asks for the .p12 password, then the keychain password)..."
security export -k login.keychain-db -t identities -f pkcs12 -o "$P12"

if [[ ! -s "$P12" ]]; then
	echo "Export failed: $P12 is missing or empty, secret not changed." >&2
	exit 1
fi

base64 -i "$P12" | gh secret set MACOS_CERT_P12
echo "Done: MACOS_CERT_P12 updated, exported file deleted."
