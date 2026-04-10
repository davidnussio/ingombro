import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "disk-scanner",
		identifier: "disk-scanner.electrobun.dev",
		version: "0.0.1",
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
} satisfies ElectrobunConfig;
