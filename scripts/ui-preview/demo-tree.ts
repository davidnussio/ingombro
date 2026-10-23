// A small but realistic "~/Developer" tree for the UI preview: projects of several kinds,
// with build output, dependency folders and a couple of secrets for Smart Clean to find.
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const KB = 1024;
const MB = 1024 * KB;

// path → size in bytes (directories are implied)
const FILES: Record<string, number> = {
	"storefront/package.json": 2 * KB,
	"storefront/next.config.ts": 1 * KB,
	"storefront/src/app/page.tsx": 12 * KB,
	"storefront/src/app/layout.tsx": 4 * KB,
	"storefront/src/components/cart.tsx": 18 * KB,
	"storefront/public/hero.jpg": 3 * MB,
	"storefront/node_modules/react-dom/cjs/react-dom.development.js": 9 * MB,
	"storefront/node_modules/next/dist/compiled/webpack/bundle5.js": 14 * MB,
	"storefront/node_modules/typescript/lib/typescript.js": 8 * MB,
	"storefront/.next/cache/webpack/client-development/0.pack": 11 * MB,
	"storefront/.next/server/app/page.js": 2 * MB,
	"storefront/.env.local": 1 * KB,
	"storefront/.env.example": 1 * KB,

	"api-gateway/package.json": 2 * KB,
	"api-gateway/src/server.ts": 22 * KB,
	"api-gateway/src/routes/users.ts": 9 * KB,
	"api-gateway/dist/server.js": 1 * MB,
	"api-gateway/node_modules/effect/dist/Effect.js": 4 * MB,
	"api-gateway/node_modules/@types/node/index.d.ts": 2 * MB,
	"api-gateway/coverage/lcov-report/index.html": 600 * KB,
	"api-gateway/jest.config.js": 1 * KB,
	"api-gateway/.env": 1 * KB,

	"ml-experiments/pyproject.toml": 2 * KB,
	"ml-experiments/train.py": 14 * KB,
	"ml-experiments/notebooks/explore.ipynb": 900 * KB,
	"ml-experiments/data/train.parquet": 12 * MB,
	"ml-experiments/.venv/lib/python3.12/site-packages/numpy/core/_multiarray.so": 7 * MB,
	"ml-experiments/.venv/lib/python3.12/site-packages/torch/lib/libtorch.dylib": 10 * MB,
	"ml-experiments/__pycache__/train.cpython-312.pyc": 40 * KB,
	"ml-experiments/mlruns/0/meta.yaml": 3 * MB,

	"rust-cli/Cargo.toml": 1 * KB,
	"rust-cli/src/main.rs": 30 * KB,
	"rust-cli/target/debug/rust-cli": 9 * MB,
	"rust-cli/target/debug/deps/libclap.rlib": 5 * MB,

	"design-assets/brand/logo.svg": 40 * KB,
	"design-assets/brand/guidelines.pdf": 6 * MB,
	"design-assets/mockups/checkout.fig": 8 * MB,
	"design-assets/.DS_Store": 12 * KB,

	"dotfiles/.zshrc": 4 * KB,
	"dotfiles/install.sh": 3 * KB,
	"dotfiles/README.md": 2 * KB,

	".DS_Store": 8 * KB,
	"notes.md": 6 * KB,
};

export function makeDemoTree(base: string) {
	for (const [rel, size] of Object.entries(FILES)) {
		const path = join(base, rel);
		mkdirSync(dirname(path), { recursive: true });
		// Real bytes (not sparse) so `blocks * 512` reports the intended size
		const content = rel.endsWith(".env") || rel.includes(".env.") ? "API_KEY=sk-demo00000000000000000000\n" : Buffer.alloc(size, 7);
		writeFileSync(path, content);
	}
}
