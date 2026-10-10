import { HttpClient } from "@actions/http-client";
import {
	compareReleases,
	normalizeRelease,
	snapshotPattern,
	validateVersion,
} from "./version.ts";

interface Release {
	name: string;
	tag: string;
	platforms: { platform: string; archs: string[] }[];
}

interface Snapshot {
	date: string;
	dir: string;
	download: string;
}

interface Download {
	url: string;
	version: string;
}

export async function fetchJson<T>(url: string): Promise<T> {
	const client = new HttpClient("use-swift", [], {
		allowRetries: true,
		maxRetries: 3,
		socketTimeout: 30_000,
	});

	try {
		const response = await client.getJson<T>(url);

		if (response.statusCode !== 200 || response.result === null) {
			throw new Error(`Could not fetch ${url}: HTTP ${response.statusCode}`);
		}

		return response.result;
	} finally {
		client.dispose();
	}
}

export async function windowsDownload(
	version: string,
	arch: "x64" | "arm64",
	getJson: typeof fetchJson = fetchJson,
): Promise<Download> {
	validateVersion(version);

	const architecture = arch === "x64" ? "x86_64" : "arm64";
	const platform = arch === "x64" ? "windows10" : "windows10-arm64";
	const snapshot = snapshotPattern.exec(version);

	if (snapshot) {
		const branch = snapshot[1];
		const date = snapshot[2];

		const builds = await getJson<Record<string, Snapshot[]>>(
			`https://www.swift.org/api/v1/install/dev/${branch}/windows10.json`,
		);

		const build = builds[architecture]
			?.filter((item) => !date || item.date.startsWith(`${date} `))
			.sort((a, b) => b.date.localeCompare(a.date))[0];

		if (!build) {
			throw new Error(`No Windows ${arch} Swift snapshot matches ${version}.`);
		}

		const category =
			branch === "main" ? "development" : `swift-${branch}-branch`;

		return {
			version: `${branch}-snapshot-${build.date.slice(0, 10)}`,
			url: `https://download.swift.org/${category}/${platform}/${build.dir}/${build.download}`,
		};
	}

	const releases = await getJson<Release[]>(
		"https://www.swift.org/api/v1/install/releases.json",
	);

	const release = releases
		.filter((item) =>
			item.platforms.some(
				(platform) =>
					platform.platform === "Windows" &&
					platform.archs.includes(architecture),
			),
		)
		.filter((item) => {
			if (version === "latest") {
				return true;
			}

			if (version.split(".").length === 2) {
				return normalizeRelease(item.name).startsWith(`${version}.`);
			}

			return normalizeRelease(item.name) === version;
		})
		.sort((a, b) => compareReleases(b.name, a.name))[0];

	if (!release) {
		throw new Error(`No Windows ${arch} Swift release matches ${version}.`);
	}

	if (compareReleases(release.name, "5.10") < 0) {
		throw new Error("Windows runners require Swift 5.10 or newer.");
	}

	return {
		version: normalizeRelease(release.name),
		url: `https://download.swift.org/${release.tag.toLowerCase()}/${platform}/${release.tag}/${release.tag}-${platform}.exe`,
	};
}
