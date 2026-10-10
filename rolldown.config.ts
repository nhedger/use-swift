import { defineConfig } from "rolldown";

export default defineConfig({
	input: "src/main.ts",
	platform: "node",
	output: {
		file: "dist/index.mjs",
		format: "esm",
	},
});
