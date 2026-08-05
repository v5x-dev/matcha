import { query } from '$app/server';
import { httpError } from '$lib/server/http-error';
import * as cache from '$lib/server/event-cache';
import { discoverEventVideos, type EventVideoResult } from '$lib/server/youtube';
import { z } from 'zod';

// re-exported so components can name the shape without importing from $lib/server
export type { EventVideo, EventVideoResult, VideoSource } from '$lib/server/youtube';

/**
 * every youtube video we can tie to an event — scraped from the vex event page and webcast index,
 * then widened with the uploads of the channels behind those links.
 */
export const listEventVideos = query(
	z.number(),
	async (eventId: number): Promise<EventVideoResult> => {
		const event = await cache.getEvent(eventId);

		if (!event) httpError(404, 'event not found');

		return discoverEventVideos(event);
	}
);
