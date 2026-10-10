import { join } from "node:path";
import { addPath, exportVariable, info, warning } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { downloadTool } from "@actions/tool-cache";
import { windowsDownload } from "./releases.ts";
import { compilerVersion } from "./version.ts";

interface Environment {
	variables: Record<string, string>;
	paths: string[];
}

async function powershell(script: string): Promise<string> {
	const encoded = Buffer.from(
		`$ErrorActionPreference = 'Stop'\n${script}`,
		"utf16le",
	).toString("base64");

	const { stdout } = await getExecOutput(
		"pwsh",
		["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
		{ silent: true },
	);

	return stdout;
}

async function readEnvironment(): Promise<Environment> {
	const output = await powershell(`
$variables = @{}
$paths = @()

foreach ($scope in 'Machine', 'User') {
    foreach ($entry in [Environment]::GetEnvironmentVariables($scope).GetEnumerator()) {
        if ($entry.Key -ieq 'Path') {
            $paths += @($entry.Value -split ';' | Where-Object { $_ })
        } else {
            $variables[$entry.Key] = $entry.Value
        }
    }
}

@{ variables = $variables; paths = @($paths | Select-Object -Unique) } | ConvertTo-Json -Compress
`);

	return JSON.parse(output) as Environment;
}

async function verifyPrerequisites(arch: "x64" | "arm64"): Promise<void> {
	const component = arch === "x64" ? "x86.x64" : "ARM64";

	await powershell(String.raw`
$programFiles = [Environment]::GetFolderPath('ProgramFilesX86')
$vswhere = Join-Path $programFiles 'Microsoft Visual Studio\Installer\vswhere.exe'

if (!(Test-Path $vswhere)) {
    throw 'Swift requires Visual Studio 2022 C++ build tools and the Windows SDK.'
}

$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.${component} -property installationPath

if (!$installation) {
    throw 'The Visual Studio C++ build tools for this runner architecture are missing.'
}

$sdk = Join-Path $programFiles 'Windows Kits\10\Include'

if (!(Test-Path $sdk)) {
    throw 'Swift requires the Windows 10 or Windows 11 SDK.'
}
`);
}

export async function installOnWindows(
	version: string,
	arch: "x64" | "arm64",
	directory: string,
): Promise<void> {
	const download = await windowsDownload(version, arch);

	await verifyPrerequisites(arch);

	info(
		`Installing Swift ${download.version} using the official Windows installer...`,
	);

	const before = await readEnvironment();

	const installer = await downloadTool(
		download.url,
		join(directory, "swift-installer.exe"),
	);

	const log = join(directory, "install.log");

	const exitCode = await exec(
		`"${installer}"`,
		["/install", "/quiet", "/norestart", "/log", log],
		{ ignoreReturnCode: true },
	);

	if (exitCode !== 0 && exitCode !== 3010) {
		throw new Error(
			`Swift installer failed with exit code ${exitCode}. Log: ${log}`,
		);
	}

	if (exitCode === 3010) {
		warning(
			"The Swift installer requested a reboot; checking the toolchain before continuing.",
		);
	}

	// Installer changes live in the registry, not in the action's process environment.
	const after = await readEnvironment();

	configureEnvironment(before, after);

	const { stdout } = await getExecOutput("swift", ["--version"]);
	const installedVersion = compilerVersion(stdout);

	if (
		!download.version.includes("-snapshot-") &&
		installedVersion !== download.version
	) {
		throw new Error(
			`Expected Swift ${download.version}, but found ${installedVersion} after installation.`,
		);
	}
}

function configureEnvironment(before: Environment, after: Environment): void {
	for (const [name, value] of Object.entries(after.variables)) {
		if (
			before.variables[name] !== value ||
			/^(SDKROOT|SWIFT_.*)$/i.test(name)
		) {
			exportVariable(name, value);
		}
	}

	const oldPaths = new Set(before.paths.map((path) => path.toLowerCase()));
	const newPaths = after.paths.filter(
		(path) => !oldPaths.has(path.toLowerCase()),
	);

	// Put newly installed tools ahead of any Swift already present on the runner.
	const paths = [...newPaths, ...after.paths];

	for (const path of [...new Set(paths)].reverse()) {
		addPath(path);
	}
}
