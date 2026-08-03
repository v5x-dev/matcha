import type { EventData } from 'events.vex';

/** The fields the event index needs; full event records stay server-side until an event is opened. */
export type EventListItem = Pick<
	EventData,
	'id' | 'sku' | 'name' | 'start' | 'end' | 'level' | 'ongoing'
> & {
	location: Pick<EventData['location'], 'venue' | 'city' | 'region'>;
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
