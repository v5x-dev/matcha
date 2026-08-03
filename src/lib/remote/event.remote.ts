import { query } from '$app/server';
import { error } from '@sveltejs/kit';
import * as cache from '$lib/server/event-cache';
import type { EventData, MatchData } from 'events.vex';
import type { EventListItem } from '$lib/event-types';

export const listEvents = query<EventListItem[]>(() => cache.listEvents());

export const getEvent = query('unchecked', async (id: number): Promise<EventData> => {
	const event = await cache.getEvent(id);

	if (!event) error(404, 'event not found');

	return event;
});

export const listMatches = query('unchecked', async (eventId: number): Promise<MatchData[]> => {
	const matches = await cache.listMatches(eventId);

	if (!matches) error(404, 'event not found');

	return matches;
});
