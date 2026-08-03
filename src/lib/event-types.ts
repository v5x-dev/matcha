import type { EventData, EventLevel } from 'events.vex';

export type EventTimeframe = 'any' | 'upcoming' | 'ongoing' | 'past';

/** The fields the event index needs; full event records stay server-side until an event is opened. */
export type EventListItem = Pick<
	EventData,
	'id' | 'sku' | 'name' | 'start' | 'end' | 'level' | 'ongoing'
> & {
	location: Pick<EventData['location'], 'venue' | 'city' | 'region'>;
};

export type EventSearchInput = {
	query: string;
	levels: EventLevel[];
	regions: string[];
	timeframe: EventTimeframe;
	cursor?: string | null;
	limit?: number;
};

export type EventFacet = { value: string; count: number };

export type EventSearchResult = {
	events: EventListItem[];
	total: number;
	nextCursor: string | null;
	facets: {
		levels: EventFacet[];
		regions: EventFacet[];
	};
};

export function toEventListItem(event: EventData): EventListItem {
	return {
		id: event.id,
		sku: event.sku,
		name: event.name,
		start: event.start,
		end: event.end,
		level: event.level,
		ongoing: event.ongoing,
		location: {
			venue: event.location.venue,
			city: event.location.city,
			region: event.location.region
		}
	};
}
