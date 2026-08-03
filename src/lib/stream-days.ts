import type { MatchData } from 'events.vex';

/**
 * One session of an event, as the broadcast sees it. A two day tournament is streamed as two
 * separate recordings, each with its own clock, so nearly everything that maps a match onto film has
 * to be scoped to the day the match was played on rather than to the event.
 */
export type StreamDay = {
	/** 1-based, chronological. */
	number: number;
	label: string;
	/** the venue-local calendar date the session ran on. */
	date: string;
	startsAt: number;
	endsAt: number;
	matches: MatchData[];
};

export type StreamDayGrouping = {
	days: StreamDay[];
	/** matches robotevents has no actual start time for, e.g. unplayed elims. */
	undated: MatchData[];
};

/** a break this long splits a session even when both halves are on the same calendar date. */
const SESSION_GAP_MS = 8 * 60 * 60 * 1000;
const groupingCache = new WeakMap<readonly MatchData[], StreamDayGrouping>();
const dayIndexCache = new WeakMap<readonly StreamDay[], Map<number, StreamDay>>();

/** the actual match start is the only timestamp used to place a match in a recording session. */
export function matchDayTimestamp(match: MatchData): string | null {
	return match.started ?? null;
}

/**
 * Split an event's matches into the sessions they were played in. Robotevents timestamps carry the
 * venue's utc offset, so the calendar date in the string is already the local one and can be
 * compared directly — no guessing at the event's timezone.
 */
export function groupMatchesByStreamDay(matches: MatchData[]): StreamDayGrouping {
	const cached = groupingCache.get(matches);
	if (cached) return cached;

	const undated: MatchData[] = [];
	const dated = matches.flatMap((match) => {
		const value = matchDayTimestamp(match);
		const at = value === null ? NaN : Date.parse(value);

		if (value === null || !Number.isFinite(at)) {
			undated.push(match);
			return [];
		}

		return [{ match, at, date: value.slice(0, 10) }];
	});

	dated.sort((a, b) => a.at - b.at);

	const days: StreamDay[] = [];

	for (const { match, at, date } of dated) {
		const current = days.at(-1);

		if (current && current.date === date && at - current.endsAt < SESSION_GAP_MS) {
			current.matches.push(match);
			current.endsAt = Math.max(current.endsAt, at);
			continue;
		}

		days.push({
			number: days.length + 1,
			label: `day ${days.length + 1}`,
			date,
			startsAt: at,
			endsAt: at,
			matches: [match]
		});
	}

	const grouping = { days, undated };
	groupingCache.set(matches, grouping);
	return grouping;
}

/** The session a match belongs to, or `null` when it has no time to place it by. */
export function streamDayOf(days: StreamDay[], match: MatchData): StreamDay | null {
	let index = dayIndexCache.get(days);
	if (!index) {
		index = new Map(
			days.flatMap((day) => day.matches.map((candidate) => [candidate.id, day] as const))
		);
		dayIndexCache.set(days, index);
	}

	return index.get(match.id) ?? null;
}
