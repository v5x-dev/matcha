import type { EventLevel } from 'events.vex';
import type { EventTimeframe } from '$lib/event-types';

export type Timeframe = EventTimeframe;

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
