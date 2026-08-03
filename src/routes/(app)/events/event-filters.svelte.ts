import type { EventLevel } from 'events.vex';
import type { EventListItem } from '$lib/event-types';
import type Fuse from 'fuse.js';
import { SvelteDate, SvelteMap, SvelteSet } from 'svelte/reactivity';

export type Timeframe = 'any' | 'upcoming' | 'ongoing' | 'past';

export const levels: EventLevel[] = [
	'World',
	'Signature',
	'National',
	'Regional',
	'State',
	'Other'
];

export const timeframes: { value: Timeframe; label: string }[] = [
	{ value: 'any', label: 'any time' },
	{ value: 'upcoming', label: 'upcoming' },
	{ value: 'ongoing', label: 'happening now' },
	{ value: 'past', label: 'past' }
];

export class EventFilters {
	query = $state('');
	levels = $state<EventLevel[]>([]);
	regions = $state<string[]>([]);
	timeframe = $state<Timeframe>('any');

	get activeCount(): number {
		return this.facetCount + (this.query.trim() ? 1 : 0);
	}

	/** everything except the free-text query, for ui that shows the query separately. */
	get facetCount(): number {
		return this.levels.length + this.regions.length + (this.timeframe === 'any' ? 0 : 1);
	}

	toggleLevel(level: EventLevel) {
		this.levels = this.levels.includes(level)
			? this.levels.filter((l) => l !== level)
			: [...this.levels, level];
	}

	toggleRegion(region: string) {
		this.regions = this.regions.includes(region)
			? this.regions.filter((r) => r !== region)
			: [...this.regions, region];
	}

	reset() {
		this.query = '';
		this.levels = [];
		this.regions = [];
		this.timeframe = 'any';
	}
}

const searchKeys = [
	{ name: 'name', weight: 2 },
	'sku',
	'location.venue',
	'location.city',
	'location.region'
];

const parsedEventTimes = new WeakMap<EventListItem, { start: number | null; end: number | null }>();

function matchesTimeframe(event: EventListItem, timeframe: Timeframe): boolean {
	if (timeframe === 'any') return true;

	const now = Date.now();
	let times = parsedEventTimes.get(event);
	if (!times) {
		const start = event.start ? Date.parse(event.start) : null;
		times = {
			start: start !== null && Number.isFinite(start) ? start : null,
			end: event.end ? Date.parse(event.end) : start
		};
		parsedEventTimes.set(event, times);
	}

	const { start, end } = times;

	if (start === null || end === null) return false;
	if (timeframe === 'upcoming') return start > now;
	if (timeframe === 'past') return end < now;
	return start <= now && end >= now;
}

const searchIndexes = new WeakMap<readonly EventListItem[], Fuse<EventListItem>>();

async function searchIndex(events: readonly EventListItem[]) {
	let fuse = searchIndexes.get(events);
	if (!fuse) {
		const { default: FuseConstructor } = await import('fuse.js');
		fuse = new FuseConstructor(events, { keys: searchKeys, threshold: 0.35, ignoreLocation: true });
		searchIndexes.set(events, fuse);
	}
	return fuse;
}

export async function filterEvents(
	events: EventListItem[],
	filters: EventFilters
): Promise<EventListItem[]> {
	let out = events;

	if (filters.levels.length > 0) {
		out = out.filter((event) => event.level && filters.levels.includes(event.level));
	}

	if (filters.regions.length > 0) {
		out = out.filter(
			(event) => event.location.region && filters.regions.includes(event.location.region)
		);
	}

	if (filters.timeframe !== 'any') {
		out = out.filter((event) => matchesTimeframe(event, filters.timeframe));
	}

	const query = filters.query.trim();
	if (query) {
		const allowed = new SvelteSet(out);
		out = (await searchIndex(events))
			.search(query)
			.map((result) => result.item)
			.filter((event) => allowed.has(event));
	}

	return out;
}

export type Facet = { value: string; count: number };

export function facetCounts(
	events: EventListItem[],
	pick: (event: EventListItem) => string | undefined
) {
	const counts = new SvelteMap<string, number>();

	for (const event of events) {
		const value = pick(event);
		if (!value) continue;
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}

	return [...counts.entries()]
		.map(([value, count]): Facet => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function levelFacets(events: EventListItem[]): Facet[] {
	const counts = facetCounts(events, (event) => event.level);
	return levels
		.map((level) => counts.find((facet) => facet.value === level) ?? { value: level, count: 0 })
		.filter((facet) => facet.count > 0);
}

export function regionFacets(events: EventListItem[]): Facet[] {
	return facetCounts(events, (event) => event.location.region);
}

const rangeFormatter = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric'
});

export function formatRange(start?: string, end?: string): string {
	if (!start) return 'date tbd';
	return rangeFormatter
		.formatRange(new SvelteDate(start), new SvelteDate(end ?? start))
		.toLowerCase();
}
