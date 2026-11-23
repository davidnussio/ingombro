import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Ingombro",
		identifier: "ingombro.electrobun.dev",
		version: "2.0.1",
	},
	build: {
		useAsar: false,
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			"src/assets/icon.png": "views/mainview/assets/icon.png",
		},
		mac: {
			// Developer ID signature + Apple notarization for canary/stable builds
			// (dev builds skip both). Credentials come from ELECTROBUN_* env vars:
			// ELECTROBUN_DEVELOPER_ID, ELECTROBUN_APPLEAPIKEY,
			// ELECTROBUN_APPLEAPIISSUER, ELECTROBUN_APPLEAPIKEYPATH.
			codesign: true,
			notarize: true,
		},
		win: {
			icon: "assets/icon.ico",
		},
		linux: {
			icon: "assets/icon.png",
		},
	},
	release: {
		baseUrl:
			"https://github.com/davidnussio/ingombro/releases/latest/download",
		generatePatch: true,
	},
} satisfies ElectrobunConfig;
