import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { addPath, exportVariable, info } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { downloadTool, extractTar } from "@actions/tool-cache";

export async function installWithSwiftly(
	version: string,
	platform: "darwin" | "linux",
	arch: "x64" | "arm64",
	directory: string,
): Promise<void> {
	const home = join(directory, "swiftly");
	const bin = join(home, "bin");

	await mkdir(home, { recursive: true });

	exportVariable("SWIFTLY_HOME_DIR", home);
	exportVariable("SWIFTLY_BIN_DIR", bin);
	exportVariable(
		"SWIFTLY_TOOLCHAINS_DIR",
		platform === "darwin"
			? join(homedir(), "Library", "Developer", "Toolchains")
			: join(home, "toolchains"),
	);

	info("Installing the latest Swiftly release...");

	const bootstrap = await downloadSwiftly(platform, arch, directory);

	await exec(
		`"${bootstrap}"`,
		[
			"init",
			"--assume-yes",
			"--skip-install",
			"--no-modify-profile",
			"--quiet-shell-followup",
		],
		{ cwd: home },
	);

	addPath(bin);

	const swiftly = join(bin, "swiftly");

	await exec(`"${swiftly}"`, ["--version"]);
	info(`Installing Swift ${version}...`);

	const postInstall = join(directory, "post-install.sh");

	await exec(
		`"${swiftly}"`,
		["install", version, "--assume-yes", "--post-install-file", postInstall],
		{ cwd: home },
	);

	if (platform === "linux" && existsSync(postInstall)) {
		await installDependencies(postInstall);
	}

	await selectToolchain(swiftly, version, home, platform);
}

async function downloadSwiftly(
	platform: "darwin" | "linux",
	arch: "x64" | "arm64",
	directory: string,
): Promise<string> {
	if (platform === "linux") {
		const architecture = arch === "arm64" ? "aarch64" : "x86_64";
		const archive = await downloadTool(
			`https://download.swift.org/swiftly/linux/swiftly-${architecture}.tar.gz`,
		);

		const extracted = await extractTar(archive, join(directory, "extracted"));

		return join(extracted, "swiftly");
	}

	const pkg = await downloadTool(
		"https://download.swift.org/swiftly/darwin/swiftly.pkg",
		join(directory, "swiftly.pkg"),
	);

	const expanded = join(directory, "expanded");

	await exec("pkgutil", ["--check-signature", pkg]);
	await exec("pkgutil", ["--expand-full", pkg, expanded]);

	const files = await readdir(expanded, {
		recursive: true,
		withFileTypes: true,
	});

	const binaries = files.filter(
		(file) => file.isFile() && file.name === "swiftly",
	);
	const binary = binaries[0];

	if (binaries.length !== 1 || !binary) {
		throw new Error("Could not locate Swiftly in the macOS package.");
	}

	return join(binary.parentPath, binary.name);
}

async function installDependencies(postInstall: string): Promise<void> {
	info("Installing Swift's system dependencies...");

	const script = await readFile(postInstall, "utf8");

	if (script.includes("apt-get")) {
		await asRoot("apt-get", ["update"]);
	}

	await asRoot("env", [
		"DEBIAN_FRONTEND=noninteractive",
		"bash",
		"-e",
		postInstall,
	]);
}

async function selectToolchain(
	swiftly: string,
	version: string,
	home: string,
	platform: "darwin" | "linux",
): Promise<void> {
	await exec(
		`"${swiftly}"`,
		["use", version, "--global-default", "--assume-yes"],
		{ cwd: home },
	);

	const { stdout } = await getExecOutput(
		`"${swiftly}"`,
		["use", "--global-default", "--print-location"],
		{ cwd: home, silent: true },
	);

	const toolchain = stdout.trim();
	const toolchainBin = join(toolchain, "usr", "bin");

	if (!toolchain || !existsSync(join(toolchainBin, "swift"))) {
		throw new Error(
			`Swiftly returned an invalid toolchain location: ${toolchain}`,
		);
	}

	// Pin the requested compiler ahead of Swiftly's project-aware proxies.
	addPath(toolchainBin);

	if (platform === "darwin") {
		const { stdout: bundle } = await getExecOutput(
			"/usr/bin/plutil",
			["-extract", "CFBundleIdentifier", "raw", join(toolchain, "Info.plist")],
			{ silent: true },
		);

		exportVariable("TOOLCHAINS", bundle.trim());
	}
}

async function asRoot(command: string, args: string[]): Promise<void> {
	if (process.getuid?.() === 0) {
		await exec(command, args);
	} else {
		await exec("sudo", ["-n", command, ...args]);
	}
}
