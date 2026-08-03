import { rounds, type MatchData } from 'events.vex';
import { groupMatchesByStreamDay, type StreamDayGrouping } from './stream-days';

export const eventRoundGroups = [
	{ round: rounds.Qualification, label: 'qualification' },
	{ round: rounds.RoundOf16, label: 'round of 16' },
	{ round: rounds.Quarterfinals, label: 'quarterfinals' },
	{ round: rounds.Semifinals, label: 'semifinals' },
	{ round: rounds.Finals, label: 'finals' },
	{ round: rounds.Practice, label: 'practice' },
	{ round: rounds.RoundRobin, label: 'round robin' },
	{ round: rounds.TopN, label: 'top n' }
] as const;

function sortMatches(a: MatchData, b: MatchData): number {
	return a.instance - b.instance || a.matchnum - b.matchnum;
}

/** matches in the same order they appear in the event sidebar. */
export function orderedEventMatches(
	matches: MatchData[],
	grouping: StreamDayGrouping = groupMatchesByStreamDay(matches)
): MatchData[] {
	const sections =
		grouping.days.length > 1
			? [
					...grouping.days.map((day) => day.matches),
					...(grouping.undated.length > 0 ? [grouping.undated] : [])
				]
			: [matches];

	return sections.flatMap((section) =>
		eventRoundGroups.flatMap(({ round }) =>
			section.filter((match) => match.round === round).sort(sortMatches)
		)
	);
}
