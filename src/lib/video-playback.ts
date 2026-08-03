import type { EventVideo } from '$lib/remote/video.remote';
import { groupMatchesByStreamDay, streamDayOf, type StreamDay } from '$lib/stream-days';
import type { MatchData } from 'events.vex';

export type MatchPlayback = {
	video: EventVideo;
	startSeconds: number;
	endSeconds: number;
	/** the session the match was played in, when its actual start is available. */
	day: StreamDay | null;
};

const DEFAULT_MATCH_WINDOW_SECONDS = 165;

type Division = MatchData['division'];

function timestamp(value?: string): number | null {
	if (!value) return null;

	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** match boundaries come from the actual match start, never from the published schedule. */
function matchTime(match: MatchData): number | null {
	return timestamp(match.started);
}

/**
 * The YouTube live start is the clock shared by the event and the recording. For the uncommon
 * response that only has an end and duration, derive the same start from those two values. The
 * YouTube scheduled start is only a fallback for the recording's own clock; VEX match scheduling
 * never enters this calculation.
 */
function videoStart(video: EventVideo): number | null {
	const direct = timestamp(video.actualStartTime) ?? timestamp(video.scheduledStartTime);
	if (direct !== null) return direct;

	const end = timestamp(video.actualEndTime);
	if (end !== null && video.durationSeconds !== undefined) {
		return end - video.durationSeconds * 1000;
	}

	return null;
}

function videoEnd(video: EventVideo, start: number): number | null {
	return (
		timestamp(video.actualEndTime) ??
		(video.durationSeconds === undefined ? null : start + video.durationSeconds * 1000)
	);
}

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function divisionAliases(division: Division): string[] {
	return [
		...new Set([division.name, division.code].filter(Boolean).map((value) => normalize(value!)))
	].filter(Boolean);
}

function titleNamesDivision(title: string, division: Division): boolean {
	const normalizedTitle = ` ${normalize(title)} `;
	return divisionAliases(division).some((alias) => normalizedTitle.includes(` ${alias} `));
}

/**
 * Whether a recording covers the session at all. Containing the match itself is the real test, but
 * a stream whose length YouTube does not report has no end to test against — without this, day one's
 * recording would go on swallowing every later day's matches.
 */
function videoCoversDay(video: EventVideo, start: number, day: StreamDay | null): boolean {
	if (!day) return true;

	const end = videoEnd(video, start);
	return start <= day.endsAt && (end === null || end >= day.startsAt);
}

/**
 * Find the broadcast that contains a match and the offset of the match within it. At events with
 * simultaneous division streams, an explicitly named matching division wins and a stream that
 * explicitly names another division is excluded.
 */
export function matchPlayback(
	videos: EventVideo[],
	match: MatchData,
	divisions: Division[],
	matches: MatchData[] = [],
	days: StreamDay[] = groupMatchesByStreamDay(matches).days
): MatchPlayback | null {
	const day = streamDayOf(days, match);
	const sessionMatches = day?.matches ?? matches;
	const matchTimestamp = matchTime(match);
	if (matchTimestamp === null) return null;

	const candidates = videos.flatMap((video) => {
		const start = videoStart(video);
		if (start === null || matchTimestamp < start) return [];

		const end = videoEnd(video, start);
		if (end !== null && matchTimestamp > end) return [];
		if (!videoCoversDay(video, start, day)) return [];

		const namesTargetDivision = titleNamesDivision(video.title, match.division);
		const namesAnotherDivision = divisions.some(
			(division) => division.id !== match.division.id && titleNamesDivision(video.title, division)
		);
		if (!namesTargetDivision && namesAnotherDivision) return [];

		return [
			{
				video,
				start,
				namesTargetDivision
			}
		];
	});

	candidates.sort(
		(a, b) =>
			Number(b.namesTargetDivision) - Number(a.namesTargetDivision) ||
			b.video.confidence - a.video.confidence ||
			b.start - a.start
	);

	const selected = candidates[0];
	if (!selected) return null;

	const startSeconds = Math.max(0, Math.floor((matchTimestamp - selected.start) / 1000));
	const videoEndSeconds = selected.video.durationSeconds ?? Number.POSITIVE_INFINITY;
	// the next match is only a boundary within the same session — the first match of the next day is
	// hours away and in a different recording, so it would stretch the last match of a day to the end
	const nextMatchTime = sessionMatches
		.filter((candidate) => candidate.id !== match.id && candidate.division.id === match.division.id)
		.map((candidate) => matchTime(candidate))
		.filter((candidate): candidate is number => candidate !== null && candidate > matchTimestamp)
		.sort((a, b) => a - b)[0];
	const inferredEndSeconds =
		nextMatchTime === undefined
			? startSeconds + DEFAULT_MATCH_WINDOW_SECONDS
			: // Slider maxima are inclusive, so stop on the final whole second before the next match.
				Math.floor((nextMatchTime - selected.start) / 1000) - 1;

	return {
		video: selected.video,
		startSeconds,
		endSeconds: Math.max(startSeconds + 1, Math.min(inferredEndSeconds, videoEndSeconds)),
		day
	};
}
