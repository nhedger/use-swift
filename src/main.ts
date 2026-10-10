import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { getInput, info, setFailed, setOutput } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { installWithSwiftly } from "./swiftly.ts";
import { compilerVersion, validateVersion } from "./version.ts";
import { installOnWindows } from "./windows.ts";

async function run() {
	const version = getInput("version") || "latest";

	validateVersion(version);

	const platform = process.platform;

	if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
		throw new Error(`Unsupported runner platform: ${platform}`);
	}

	if (process.arch !== "x64" && process.arch !== "arm64") {
		throw new Error(`Unsupported runner architecture: ${process.arch}`);
	}

	const runnerTemp = process.env.RUNNER_TEMP;

	if (!runnerTemp) {
		throw new Error("RUNNER_TEMP is not set.");
	}

	const directory = await mkdtemp(join(runnerTemp, "use-swift-"));

	if (platform === "win32") {
		await installOnWindows(version, process.arch, directory);
	} else {
		await installWithSwiftly(version, platform, process.arch, directory);
	}

	const { stdout } = await getExecOutput("swift", ["--version"]);
	const installedVersion = compilerVersion(stdout);

	setOutput("version", installedVersion);
	info(`Swift ${installedVersion} is ready.`);
}

run().catch((error: unknown) => {
	setFailed(error instanceof Error ? error : String(error));
});
