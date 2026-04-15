import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Ingombro",
		identifier: "ingombro.electrobun.dev",
		version: "1.2.0",
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
