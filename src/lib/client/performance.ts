let metricSequence = 0;

export type BrowserMetric = {
	name: string;
	durationMs: number;
	fields?: Record<string, boolean | number | string | null | undefined>;
};

function record(name: string, durationMs: number, fields: BrowserMetric['fields'] = {}) {
	if (typeof window === 'undefined') return;

	const entryName = `${name}#${++metricSequence}`;
	try {
		const endMark = `${entryName}:end`;
		const startMark = `${entryName}:start`;
		const end = performance.now();
		performance.mark(startMark, { startTime: Math.max(0, end - durationMs) });
		performance.mark(endMark, { startTime: end });
		performance.measure(entryName, startMark, endMark);
	} catch {
		// Performance entries are best effort; the event below still records the metric.
	}

	const metric = { type: 'matcha.browser_timing', name, durationMs, ...fields };
	const metricsWindow = window as Window & {
		__matchaPerformance?: Array<typeof metric>;
	};
	(metricsWindow.__matchaPerformance ??= []).push(metric);
	window.dispatchEvent(new CustomEvent('matcha:performance', { detail: metric }));
	console.info(JSON.stringify(metric));
}

export function recordBrowserMetric(
	name: string,
	durationMs: number,
	fields: BrowserMetric['fields'] = {}
) {
	record(name, durationMs, fields);
}

export function startBrowserMetric(name: string, fields: BrowserMetric['fields'] = {}) {
	return { name, startedAt: performance.now(), fields };
}

export function finishBrowserMetric(
	metric: ReturnType<typeof startBrowserMetric> | null | undefined,
	fields: BrowserMetric['fields'] = {}
) {
	if (!metric) return;
	record(metric.name, performance.now() - metric.startedAt, { ...metric.fields, ...fields });
}

export function initialPayloadBytes(): number | null {
	if (typeof window === 'undefined') return null;
	const navigation = performance.getEntriesByType('navigation')[0] as
		PerformanceNavigationTiming | undefined;
	return navigation?.transferSize || navigation?.encodedBodySize || null;
}
