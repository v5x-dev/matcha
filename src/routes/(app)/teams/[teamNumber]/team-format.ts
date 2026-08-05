import type { TeamOverview } from '$lib/team-types';

const rangeFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function formatRange(start?: string, end?: string): string {
	if (!start) return 'date tbd';
	return rangeFormatter.formatRange(new Date(start), new Date(end ?? start)).toLowerCase();
}

/** event names are long and almost always prefixed with the interesting part. */
export function shortEventName(name: string): string {
	return (name.split(':')[0] ?? name).trim().toLowerCase();
}

export function teamLocation(team: TeamOverview['team']): string {
	return [team.location?.city, team.location?.region, team.location?.country]
		.filter(Boolean)
		.join(', ')
		.toLowerCase();
}

export function formatNumber(value: number | null, digits = 1): string {
	return value === null ? '—' : value.toFixed(digits);
}

export function formatInteger(value: number | null): string {
	return value === null ? '—' : Math.round(value).toString();
}

export function signed(value: number | null, digits = 1): string {
	if (value === null) return '—';
	return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}
