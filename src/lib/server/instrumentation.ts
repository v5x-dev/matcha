type TimingFields = Record<string, boolean | number | string | null | undefined>;

function errorMessage(error: unknown): string | undefined {
	return error instanceof Error ? error.message : error ? String(error) : undefined;
}

/**
 * Keep server timings in structured logs. This is intentionally dependency-free so the same
 * instrumentation works in local development and in the adapter's production runtime.
 */
export function recordServerTiming(name: string, durationMs: number, fields: TimingFields = {}) {
	console.info(
		JSON.stringify({
			type: 'matcha.server_timing',
			name,
			durationMs: Math.round(durationMs * 100) / 100,
			...fields
		})
	);
}

export async function measureServer<T>(
	name: string,
	work: () => Promise<T>,
	fields: TimingFields = {}
): Promise<T> {
	const startedAt = performance.now();

	try {
		const result = await work();
		recordServerTiming(name, performance.now() - startedAt, { ...fields, success: true });
		return result;
	} catch (error) {
		recordServerTiming(name, performance.now() - startedAt, {
			...fields,
			success: false,
			error: errorMessage(error)
		});
		throw error;
	}
}

/** Wrap an upstream request so every external dependency has one timing record. */
export async function measureExternalRequest<T>(
	name: string,
	work: () => Promise<T>,
	fields: TimingFields = {}
): Promise<T> {
	const startedAt = performance.now();

	try {
		const result = await work();
		recordServerTiming(`external.${name}`, performance.now() - startedAt, {
			...fields,
			success: true
		});
		return result;
	} catch (error) {
		recordServerTiming(`external.${name}`, performance.now() - startedAt, {
			...fields,
			success: false,
			error: errorMessage(error)
		});
		throw error;
	}
}
