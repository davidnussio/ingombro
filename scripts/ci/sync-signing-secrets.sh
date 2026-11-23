#!/usr/bin/env bash
# Syncs the Apple signing secrets from envsec to the GitHub secrets the release
# workflow reads. envsec (context `apple`, override with ENVSEC_CONTEXT) is the
# source of truth:
#
#   macos.cert.password  password of the .p12 (generate it once with
#                        `envsec -c apple secret macos.cert.password -a`)
#   apple.api.key.p8     base64 of the App Store Connect API key (.p8)
#   apple.api.key.id     its Key ID
#   apple.api.issuer     its Issuer ID
#   macos.cert.p12       written by this script: base64 of a .p12 that holds
#                        ONLY the Developer ID identity
#
# `security export` exports every identity of the keychain, so the script
# rebuilds the .p12 with just the Developer ID certificate and its key, checks
# the password opens it, stores it in envsec and uploads the five secrets.
# Run it again when the certificate is renewed.
#
# Usage: scripts/ci/sync-signing-secrets.sh [--repo owner/name]
#   DRY_RUN=1          rebuild and check the .p12, change nothing
#   SOURCE_KEYCHAIN=…  keychain to export from (default: login.keychain-db)
set -euo pipefail

CTX="${ENVSEC_CONTEXT:-apple}"
IDENTITY="${SIGNING_IDENTITY:-Developer ID Application: dambox Sagl (CLFTJ6F63K)}"
KEYCHAIN="${SOURCE_KEYCHAIN:-login.keychain-db}"
OPENSSL=/usr/bin/openssl # LibreSSL: writes .p12 files every macOS can import
GH_ARGS=("$@")

get() { envsec -c "$CTX" get "$1"; }

P12_PASSWORD="$(get macos.cert.password)"
if [[ -z "$P12_PASSWORD" ]]; then
	echo "envsec $CTX: macos.cert.password is empty." >&2
	exit 1
fi
export P12_PASSWORD

WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

echo "Exporting the keychain identities (macOS may ask for the keychain password)..."
security export -k "$KEYCHAIN" -t identities -f pkcs12 -P "$P12_PASSWORD" -o "$WORK/all.p12" > /dev/null

# Split the export into one PEM file per certificate and per private key.
"$OPENSSL" pkcs12 -in "$WORK/all.p12" -nokeys -passin env:P12_PASSWORD 2> /dev/null |
	awk -v d="$WORK" '/BEGIN CERTIFICATE/{n++; f=d"/cert"n".pem"} f{print > f} /END CERTIFICATE/{f=""}'
"$OPENSSL" pkcs12 -in "$WORK/all.p12" -nocerts -nodes -passin env:P12_PASSWORD 2> /dev/null |
	awk -v d="$WORK" '/BEGIN .*PRIVATE KEY/{n++; f=d"/key"n".pem"} f{print > f} /END .*PRIVATE KEY/{f=""}'

CERT=""
for c in "$WORK"/cert*.pem; do
	if "$OPENSSL" x509 -in "$c" -noout -subject | grep -qF "CN=$IDENTITY"; then
		CERT="$c"
		break
	fi
done
if [[ -z "$CERT" ]]; then
	echo "\"$IDENTITY\" not found in $KEYCHAIN." >&2
	exit 1
fi

CERT_PUB="$("$OPENSSL" x509 -in "$CERT" -noout -pubkey)"
KEY=""
for k in "$WORK"/key*.pem; do
	if [[ "$("$OPENSSL" pkey -in "$k" -pubout 2> /dev/null)" == "$CERT_PUB" ]]; then
		KEY="$k"
		break
	fi
done
if [[ -z "$KEY" ]]; then
	echo "Private key of \"$IDENTITY\" not found in the export." >&2
	exit 1
fi

"$OPENSSL" pkcs12 -export -in "$CERT" -inkey "$KEY" -name "$IDENTITY" \
	-out "$WORK/developer-id.p12" -passout env:P12_PASSWORD

# Same check the CI import does, plus: exactly one certificate and one key.
CERTS="$("$OPENSSL" pkcs12 -in "$WORK/developer-id.p12" -nokeys -passin env:P12_PASSWORD 2> /dev/null | grep -c 'BEGIN CERTIFICATE')"
KEYS="$("$OPENSSL" pkcs12 -in "$WORK/developer-id.p12" -nocerts -nodes -passin env:P12_PASSWORD 2> /dev/null | grep -c 'BEGIN .*PRIVATE KEY')"
if [[ "$CERTS" != 1 || "$KEYS" != 1 ]]; then
	echo "The rebuilt .p12 has $CERTS certificates and $KEYS keys, expected 1 and 1." >&2
	exit 1
fi

P12_B64="$(base64 -i "$WORK/developer-id.p12")"
if [[ "${DRY_RUN:-}" == "1" ]]; then
	echo "DRY_RUN: .p12 rebuilt with only \"$IDENTITY\" ($(wc -c < "$WORK/developer-id.p12" | tr -d " ") bytes), nothing changed."
	exit 0
fi
printf '%s' "$P12_B64" | envsec -c "$CTX" add macos.cert.p12 > /dev/null
echo "envsec $CTX: macos.cert.p12 updated (Developer ID identity only)."

printf '%s' "$P12_B64" | gh secret set MACOS_CERT_P12 ${GH_ARGS[@]+"${GH_ARGS[@]}"}
printf '%s' "$P12_PASSWORD" | gh secret set MACOS_CERT_PASSWORD ${GH_ARGS[@]+"${GH_ARGS[@]}"}
get apple.api.key.p8 | tr -d '\n' | gh secret set APPLE_API_KEY_P8 ${GH_ARGS[@]+"${GH_ARGS[@]}"}
get apple.api.key.id | tr -d '\n' | gh secret set APPLE_API_KEY_ID ${GH_ARGS[@]+"${GH_ARGS[@]}"}
get apple.api.issuer | tr -d '\n' | gh secret set APPLE_API_ISSUER ${GH_ARGS[@]+"${GH_ARGS[@]}"}
echo "Done: the five signing secrets are in sync with envsec $CTX."
