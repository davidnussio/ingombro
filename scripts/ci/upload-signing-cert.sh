#!/usr/bin/env bash
# Exports the Developer ID identity from the login keychain and uploads it to
# GitHub as MACOS_CERT_P12, together with its password as MACOS_CERT_PASSWORD,
# then deletes the exported file. Both secrets come from the same password, so
# they cannot drift apart. Run it again whenever the certificate is renewed.
set -euo pipefail

read -r -s -p "Password for the .p12 (new, used only for this export): " P12_PASSWORD
echo
read -r -s -p "Repeat the password: " P12_PASSWORD_CHECK
echo
if [[ -z "$P12_PASSWORD" || "$P12_PASSWORD" != "$P12_PASSWORD_CHECK" ]]; then
	echo "Passwords are empty or do not match, nothing changed." >&2
	exit 1
fi
export P12_PASSWORD

P12="$(mktemp -d)/developer-id.p12"
trap 'rm -f "$P12"' EXIT

echo "Exporting the Developer ID identity (macOS may ask for the keychain password)..."
security export -k login.keychain-db -t identities -f pkcs12 -P "$P12_PASSWORD" -o "$P12"

if [[ ! -s "$P12" ]]; then
	echo "Export failed: the file is missing or empty, secrets not changed." >&2
	exit 1
fi
# Same check the CI import does: the password must open the file.
if ! /usr/bin/openssl pkcs12 -in "$P12" -noout -passin env:P12_PASSWORD 2>/dev/null; then
	echo "The password does not open the exported .p12, secrets not changed." >&2
	exit 1
fi

base64 -i "$P12" | gh secret set MACOS_CERT_P12
printf '%s' "$P12_PASSWORD" | gh secret set MACOS_CERT_PASSWORD
echo "Done: MACOS_CERT_P12 and MACOS_CERT_PASSWORD updated, exported file deleted."
