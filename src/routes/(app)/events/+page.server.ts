import * as cache from '$lib/server/event-cache';
import { measureServer } from '$lib/server/instrumentation';

export async function load() {
	return {
		eventSearch: await measureServer('event.load', () =>
			cache.searchEvents({ query: '', levels: [], regions: [], timeframe: 'any', limit: 50 })
		)
	};
}
