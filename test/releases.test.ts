import assert from "node:assert/strict";
import { test } from "node:test";
import { type fetchJson, windowsDownload } from "../src/releases.ts";
import { compilerVersion, validateVersion } from "../src/version.ts";

const release = (name: string, archs = ["x86_64", "arm64"]) => ({
	name,
	tag: `swift-${name}-RELEASE`,
	platforms: [{ platform: "Windows", archs }],
});

function api(data: unknown): typeof fetchJson {
	return async <T>() => data as T;
}

test("latest selects numerically, ignores non-Windows releases and filters architecture", async () => {
	const get = api([
		release("6.9.1"),
		release("6.10.2", ["x86_64"]),
		release("6.10.1"),
		{
			...release("7.0"),
			platforms: [{ platform: "Linux", archs: ["x86_64"] }],
		},
	]);

	const x64 = await windowsDownload("latest", "x64", get);

	assert.equal(x64.version, "6.10.2");
	assert.equal(
		x64.url,
		"https://download.swift.org/swift-6.10.2-release/windows10/swift-6.10.2-RELEASE/swift-6.10.2-RELEASE-windows10.exe",
	);

	const arm64 = await windowsDownload("latest", "arm64", get);

	assert.equal(arm64.version, "6.10.1");
	assert.match(arm64.url, /\/windows10-arm64\/.*-windows10-arm64\.exe$/);
});

test("6.1 selects the latest patch without crossing minor versions", async () => {
	const download = await windowsDownload(
		"6.1",
		"x64",
		api([
			release("6.2"),
			release("6.1.10"),
			release("6.1"),
			release("6.10"),
			release("6.1.9"),
		]),
	);

	assert.equal(download.version, "6.1.10");
});

test("explicit patch zero preserves the official release tag's spelling", async () => {
	const download = await windowsDownload(
		"6.2.0",
		"x64",
		api([release("6.2"), release("6.2.1")]),
	);

	assert.equal(download.version, "6.2.0");
	assert.match(
		download.url,
		/swift-6\.2-release\/windows10\/swift-6\.2-RELEASE/,
	);
});

test("missing releases, unavailable architectures and legacy Windows versions fail", async () => {
	await assert.rejects(
		windowsDownload("6.2.1", "x64", api([release("6.2")])),
		/No Windows/,
	);

	await assert.rejects(
		windowsDownload("latest", "arm64", api([release("6.2", ["x86_64"])])),
		/No Windows/,
	);

	await assert.rejects(
		windowsDownload("5.9", "x64", api([release("5.9")])),
		/5.10 or newer/,
	);
});

const snapshots = {
	x86_64: [
		{
			date: "2026-10-01 10:10:00 -0600",
			dir: "swift-DEVELOPMENT-SNAPSHOT-2026-10-01-a",
			download: "swift-DEVELOPMENT-SNAPSHOT-2026-10-01-a-windows10.exe",
		},
		{
			date: "2026-10-06 10:10:00 -0600",
			dir: "swift-DEVELOPMENT-SNAPSHOT-2026-10-06-a",
			download: "swift-DEVELOPMENT-SNAPSHOT-2026-10-06-a-windows10.exe",
		},
	],
};

test("snapshots select the latest date or the requested date", async () => {
	const latest = await windowsDownload("main-snapshot", "x64", api(snapshots));

	assert.equal(latest.version, "main-snapshot-2026-10-06");
	assert.match(
		latest.url,
		/\/development\/windows10\/swift-DEVELOPMENT-SNAPSHOT-2026-10-06-a\//,
	);

	const dated = await windowsDownload(
		"main-snapshot-2026-10-01",
		"x64",
		api(snapshots),
	);

	assert.equal(dated.version, "main-snapshot-2026-10-01");

	await assert.rejects(
		windowsDownload("main-snapshot-2026-09-01", "x64", api(snapshots)),
		/No Windows/,
	);

	await assert.rejects(
		windowsDownload("main-snapshot", "arm64", api(snapshots)),
		/No Windows/,
	);
});

test("release-branch snapshots use the branch endpoint and native ARM64 artifact", async () => {
	const get: typeof fetchJson = async <T>(url: string) => {
		assert.equal(
			url,
			"https://www.swift.org/api/v1/install/dev/6.4.x/windows10.json",
		);

		return {
			arm64: [
				{
					date: "2026-10-08 10:10:00 -0600",
					dir: "swift-6.4.x-DEVELOPMENT-SNAPSHOT-2026-10-08-a",
					download:
						"swift-6.4.x-DEVELOPMENT-SNAPSHOT-2026-10-08-a-windows10-arm64.exe",
				},
			],
		} as T;
	};

	const download = await windowsDownload("6.4.x-snapshot", "arm64", get);

	assert.equal(download.version, "6.4.x-snapshot-2026-10-08");
	assert.equal(
		download.url,
		"https://download.swift.org/swift-6.4.x-branch/windows10-arm64/swift-6.4.x-DEVELOPMENT-SNAPSHOT-2026-10-08-a/swift-6.4.x-DEVELOPMENT-SNAPSHOT-2026-10-08-a-windows10-arm64.exe",
	);
});

test("invalid inputs cannot become flags, shell commands or URL paths", async () => {
	for (const version of [
		"--help",
		"6",
		"6.2; whoami",
		"../../main",
		"latest\n--no-verify",
		"",
	]) {
		assert.throws(() => validateVersion(version), /Invalid Swift version/);
	}

	await assert.rejects(
		windowsDownload("--help", "x64", async () => {
			assert.fail("Invalid input must be rejected before fetching metadata");
		}),
		/Invalid Swift version/,
	);
});

test("metadata failures propagate rather than falling back to a different toolchain", async () => {
	await assert.rejects(
		windowsDownload("latest", "x64", async () => {
			throw new Error("HTTP 503");
		}),
		/HTTP 503/,
	);
});

test("compiler versions handle Apple, Linux, Windows and development output", () => {
	assert.equal(
		compilerVersion("Apple Swift version 6.2 (swift-6.2-RELEASE)"),
		"6.2.0",
	);

	assert.equal(
		compilerVersion(
			"Swift version 6.2.1 (swift-6.2.1-RELEASE)\nTarget: x86_64-unknown-linux-gnu",
		),
		"6.2.1",
	);

	assert.equal(
		compilerVersion(
			"Swift version 6.4-dev (LLVM abc, Swift def)\r\nTarget: x86_64-unknown-windows-msvc",
		),
		"6.4-dev",
	);

	assert.throws(
		() => compilerVersion("swift not found"),
		/Could not determine/,
	);
});
