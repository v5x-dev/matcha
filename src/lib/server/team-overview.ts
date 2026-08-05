import { error } from '@sveltejs/kit';
import { Team, programs, rounds, type MatchData, type TeamData } from 'events.vex';
import { eventRoundGroups } from '$lib/match-navigation';
import type {
	MatchResult,
	TeamAwardSummary,
	TeamEventSummary,
	TeamMatchSummary,
	TeamOverview,
	TeamRecord,
	TeamSkillsSummary
} from '$lib/team-types';
import { SEASON } from './event-cache';
import { measureExternalRequest, measureServer } from './instrumentation';
import vex from './vex';

const OVERVIEW_TTL = 60 * 1000;
const MAX_OVERVIEW_ENTRIES = 64;

const overviewCache = new Map<string, { data: TeamOverview; cachedAt: number }>();
const pendingOverviews = new Map<string, Promise<TeamOverview>>();

const roundLabels = new Map<number, string>(
	eventRoundGroups.map(({ round, label }) => [round, label])
);

/** elimination rounds come after qualification in every event's ordering. */
const roundOrder = new Map<number, number>([
	[rounds.Practice, 0],
	[rounds.Qualification, 1],
	[rounds.RoundOf16, 2],
	[rounds.Quarterfinals, 3],
	[rounds.Semifinals, 4],
	[rounds.Finals, 5],
	[rounds.RoundRobin, 2],
	[rounds.TopN, 2]
]);

function emptyRecord(): TeamRecord {
	return { wins: 0, losses: 0, ties: 0, winRate: null };
}

function withWinRate(record: TeamRecord): TeamRecord {
	const played = record.wins + record.losses + record.ties;
	return { ...record, winRate: played === 0 ? null : record.wins / played };
}

function matchTime(match: MatchData): string | undefined {
	return match.started ?? match.scheduled;
}

function teamNames(alliance: MatchData['alliances'][number] | undefined): string[] {
	return (
		alliance?.teams
			.map((allianceTeam) => allianceTeam.team?.name)
			.filter((name): name is string => Boolean(name)) ?? []
	);
}

function summarizeMatch(
	match: MatchData,
	teamNumber: string,
	eventNames: Map<number, string>
): TeamMatchSummary | null {
	const own = match.alliances.find((alliance) =>
		alliance.teams.some((allianceTeam) => allianceTeam.team?.name === teamNumber)
	);
	const other = match.alliances.find((alliance) => alliance !== own);
	if (!own) return null;

	const color = own.color;
	const score = own.score ?? 0;
	const opponentScore = other?.score ?? 0;
	// the upstream team-matches endpoint reports `scored: false` even for finished matches, so treat
	// any posted score as a played match. a genuine 0-0 result does not happen in v5rc.
	const played = match.scored || score > 0 || opponentScore > 0;
	const practice = match.round === rounds.Practice;
	const result: MatchResult | null =
		!played || practice
			? null
			: score > opponentScore
				? 'win'
				: score < opponentScore
					? 'loss'
					: 'tie';

	return {
		id: match.id,
		eventId: match.event.id,
		eventName: eventNames.get(match.event.id) ?? match.event.name,
		name: match.name,
		round: match.round,
		roundLabel: roundLabels.get(match.round) ?? 'match',
		at: matchTime(match),
		played,
		practice,
		color,
		score,
		opponentScore,
		margin: score - opponentScore,
		result,
		partners: teamNames(own).filter((name) => name !== teamNumber),
		opponents: teamNames(other)
	};
}

/**
 * newest event first, then the last round played inside it. individual matches carry inconsistent
 * timestamps — eliminations are often unscheduled — so the event's own date drives the top level.
 */
function compareMatchesBy(eventStarts: Map<number, string>) {
	return (a: TeamMatchSummary, b: TeamMatchSummary): number => {
		const byEvent = (eventStarts.get(b.eventId) ?? '').localeCompare(
			eventStarts.get(a.eventId) ?? ''
		);
		if (byEvent !== 0) return byEvent;
		return (roundOrder.get(b.round) ?? 0) - (roundOrder.get(a.round) ?? 0) || b.id - a.id;
	};
}

async function buildOverview(teamNumber: string): Promise<TeamOverview> {
	const lookup = await measureExternalRequest(
		'vex.teams.get',
		() => vex.teams.getByNumber(teamNumber, programs.V5RC),
		{ teamNumber }
	);
	if (lookup.error || !lookup.data) {
		if (lookup.response.status === 404 || !lookup.data) error(404, 'team not found');
		error(502, 'team data unavailable');
	}

	const team: TeamData = lookup.data.getData();
	const wrapper = new Team(team, vex.api);
	const season = { 'season[]': [SEASON] };

	const [events, matches, rankings, skills, awards] = await Promise.all([
		measureExternalRequest('vex.team.events', () => wrapper.events(season), { teamNumber }),
		measureExternalRequest('vex.team.matches', () => wrapper.matches(season), { teamNumber }),
		measureExternalRequest('vex.team.rankings', () => wrapper.rankings(season), { teamNumber }),
		measureExternalRequest('vex.team.skills', () => wrapper.skills(season), { teamNumber }),
		measureExternalRequest('vex.team.awards', () => wrapper.awards(season), { teamNumber })
	]);

	const eventList = (events.data ?? []).map((item) => item.getData());
	const eventNames = new Map(eventList.map((item) => [item.id, item.name]));
	const eventStarts = new Map(eventList.map((item) => [item.id, item.start ?? '']));

	const matchSummaries = (matches.data ?? [])
		.map((item) => summarizeMatch(item.getData(), team.number, eventNames))
		.filter((summary): summary is TeamMatchSummary => summary !== null)
		.sort(compareMatchesBy(eventStarts));

	const awardSummaries: TeamAwardSummary[] = (awards.data ?? [])
		.filter((award) => Boolean(award.title))
		.map((award) => ({
			title: award.title!,
			eventId: award.event?.id ?? null,
			eventName: award.event?.name ?? 'unknown event',
			at: award.event?.id ? eventStart(eventList, award.event.id) : undefined
		}));

	const rankingByEvent = new Map((rankings.data ?? []).map((rank) => [rank.event?.id ?? 0, rank]));
	const awardsByEvent = new Map<number, string[]>();
	for (const award of awardSummaries) {
		if (award.eventId === null) continue;
		awardsByEvent.set(award.eventId, [...(awardsByEvent.get(award.eventId) ?? []), award.title]);
	}

	const eventSummaries: TeamEventSummary[] = eventList
		.map((item): TeamEventSummary => {
			const ranking = rankingByEvent.get(item.id);
			const eventMatches = matchSummaries.filter((match) => match.eventId === item.id);
			const record = withWinRate(
				eventMatches.reduce((totals, match) => {
					if (match.result === 'win') totals.wins += 1;
					if (match.result === 'loss') totals.losses += 1;
					if (match.result === 'tie') totals.ties += 1;
					return totals;
				}, emptyRecord())
			);

			return {
				id: item.id,
				sku: item.sku,
				name: item.name,
				start: item.start,
				end: item.end,
				level: item.level,
				ongoing: item.ongoing ?? false,
				location: { city: item.location?.city, region: item.location?.region },
				rank: ranking?.rank ?? null,
				wp: ranking?.wp ?? null,
				ap: ranking?.ap ?? null,
				sp: ranking?.sp ?? null,
				record,
				highScore: ranking?.high_score ?? null,
				averagePoints: ranking?.average_points ?? null,
				awards: awardsByEvent.get(item.id) ?? [],
				matchCount: eventMatches.length,
				scoredMatchCount: eventMatches.filter((match) => match.played).length
			};
		})
		.sort((a, b) => (b.start ?? '').localeCompare(a.start ?? '') || b.id - a.id);

	const skillRuns = skills.data ?? [];
	const bestOf = (type: 'driver' | 'programming') =>
		skillRuns
			.filter((run) => run.type === type)
			.reduce<number | null>(
				(best, run) => (run.score === undefined ? best : Math.max(best ?? 0, run.score)),
				null
			);
	const driver = bestOf('driver');
	const programming = bestOf('programming');
	const bestSkillsRun = skillRuns.reduce<(typeof skillRuns)[number] | null>(
		(best, run) =>
			run.rank === undefined ? best : best?.rank === undefined || run.rank < best.rank ? run : best,
		null
	);
	const skillsSummary: TeamSkillsSummary = {
		driver,
		programming,
		combined: driver === null && programming === null ? null : (driver ?? 0) + (programming ?? 0),
		rank: bestSkillsRun?.rank ?? null,
		eventName: bestSkillsRun?.event?.id ? (eventNames.get(bestSkillsRun.event.id) ?? null) : null
	};

	const scoredMatches = matchSummaries.filter((match) => match.played && !match.practice);
	const record = withWinRate(
		matchSummaries.reduce((totals, match) => {
			if (match.result === 'win') totals.wins += 1;
			if (match.result === 'loss') totals.losses += 1;
			if (match.result === 'tie') totals.ties += 1;
			return totals;
		}, emptyRecord())
	);
	const average = (values: number[]) =>
		values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
	const ranks = eventSummaries
		.map((item) => item.rank)
		.filter((rank): rank is number => rank !== null);

	return {
		team,
		record,
		events: eventSummaries,
		matches: matchSummaries,
		awards: awardSummaries,
		skills: skillsSummary,
		stats: {
			eventCount: eventSummaries.length,
			matchesPlayed: scoredMatches.length,
			averageScore: average(scoredMatches.map((match) => match.score)),
			highScore: scoredMatches.reduce<number | null>(
				(best, match) => Math.max(best ?? 0, match.score),
				null
			),
			averageMargin: average(scoredMatches.map((match) => match.margin)),
			bestRank: ranks.length === 0 ? null : Math.min(...ranks)
		}
	};
}

function eventStart(events: { id: number; start?: string }[], id: number): string | undefined {
	return events.find((item) => item.id === id)?.start;
}

/**
 * everything the team pages need in one round trip. the upstream API has no combined team endpoint,
 * so the five per-team calls are fanned out here and cached briefly to keep a page load to one burst.
 */
export async function getTeamOverview(teamNumber: string): Promise<TeamOverview> {
	const normalized = teamNumber.trim().toUpperCase();
	if (!normalized || normalized.length > 16) error(404, 'team not found');

	const cached = overviewCache.get(normalized);
	if (cached && Date.now() - cached.cachedAt < OVERVIEW_TTL) return cached.data;

	const pending = pendingOverviews.get(normalized);
	if (pending) return pending;

	const request = measureServer('team.overview', () => buildOverview(normalized), {
		teamNumber: normalized
	})
		.then((data) => {
			overviewCache.delete(normalized);
			overviewCache.set(normalized, { data, cachedAt: Date.now() });
			while (overviewCache.size > MAX_OVERVIEW_ENTRIES) {
				overviewCache.delete(overviewCache.keys().next().value as string);
			}
			return data;
		})
		.finally(() => pendingOverviews.delete(normalized));

	pendingOverviews.set(normalized, request);
	return request;
}
