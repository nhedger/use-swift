export const snapshotPattern =
	/^(main|\d+\.\d+(?:\.(?:\d+|x))?)-snapshot(?:-(\d{4}-\d{2}-\d{2}))?$/;

export function validateVersion(version: string): void {
	if (
		version !== "latest" &&
		!/^\d+\.\d+(?:\.\d+)?$/.test(version) &&
		!snapshotPattern.test(version)
	) {
		throw new Error(
			`Invalid Swift version "${version}". Use latest, a release such as 6.2 or 6.2.1, or a snapshot such as main-snapshot or main-snapshot-2026-10-06.`,
		);
	}
}

export function normalizeRelease(version: string): string {
	return version.split(".").length === 2 ? `${version}.0` : version;
}

export function compareReleases(a: string, b: string): number {
	const left = normalizeRelease(a).split(".").map(Number);
	const right = normalizeRelease(b).split(".").map(Number);

	for (let i = 0; i < 3; i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);

		if (difference) {
			return difference;
		}
	}

	return 0;
}

export function compilerVersion(output: string): string {
	const match = /Swift version (\d+\.\d+(?:\.\d+)?(?:-dev)?)/.exec(output);

	if (!match?.[1]) {
		throw new Error(
			`Could not determine the installed Swift version: ${output}`,
		);
	}

	return match[1].endsWith("-dev") ? match[1] : normalizeRelease(match[1]);
}
