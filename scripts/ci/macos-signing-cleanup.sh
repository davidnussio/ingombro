#!/usr/bin/env bash
# Removes the temporary keychain and API key created by macos-signing-setup.sh.
set -uo pipefail

if [[ -n "${SIGNING_KEYCHAIN:-}" ]]; then
	security delete-keychain "$SIGNING_KEYCHAIN" || true
fi
if [[ -n "${ELECTROBUN_APPLEAPIKEYPATH:-}" ]]; then
	rm -f "$ELECTROBUN_APPLEAPIKEYPATH"
fi
