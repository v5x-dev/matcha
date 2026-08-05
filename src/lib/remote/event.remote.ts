import { query } from '$app/server';
import { httpError } from '$lib/server/http-error';
import * as cache from '$lib/server/event-cache';
import type { EventData, MatchData } from 'events.vex';
import { z } from 'zod';
import type { EventLevel } from 'events.vex';
import type { EventSearchInput, EventSearchResult } from '$lib/event-types';

const searchSchema = z.object({
	query: z.string().trim().max(100),
	levels: z.array(z.string().max(32)).max(6),
	regions: z.array(z.string().max(64)).max(50),
	timeframe: z.enum(['any', 'upcoming', 'ongoing', 'past']),
	cursor: z.string().max(500).nullable().optional(),
	limit: z.number().int().min(1).max(100).optional()
});

export const searchEvents = query(searchSchema, async (input): Promise<EventSearchResult> =>
	cache.searchEvents({
		...input,
		levels: input.levels as EventLevel[],
		cursor: input.cursor ?? null
	} as EventSearchInput)
);

export const getEvent = query('unchecked', async (id: number): Promise<EventData> => {
	const event = await cache.getEvent(id);

	if (!event) httpError(404, 'event not found');

	return event;
});

export const listMatches = query('unchecked', async (eventId: number): Promise<MatchData[]> => {
	const matches = await cache.listMatches(eventId);

	if (!matches) httpError(404, 'event not found');

	return matches;
});
