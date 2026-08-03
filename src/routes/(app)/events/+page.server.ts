import * as cache from '$lib/server/event-cache';

export async function load() {
	return { events: await cache.listEvents() };
}
