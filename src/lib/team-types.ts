import type { EventLevel, TeamData } from 'events.vex';

export type MatchResult = 'win' | 'loss' | 'tie';

export type TeamRecord = {
	wins: number;
	losses: number;
	ties: number;
	/** wins / played, or null when the team has not played a scored match yet. */
	winRate: number | null;
};

export type TeamEventSummary = {
	id: number;
	sku: string;
	name: string;
	start?: string;
	end?: string;
	level?: EventLevel;
	ongoing: boolean;
	location: { city?: string; region?: string };
	rank: number | null;
	wp: number | null;
	ap: number | null;
	sp: number | null;
	record: TeamRecord;
	highScore: number | null;
	averagePoints: number | null;
	awards: string[];
};

export type TeamSkillsSummary = {
	driver: number | null;
	programming: number | null;
	combined: number | null;
	/** best (lowest) skills rank the team holds across the season. */
	rank: number | null;
	eventName: string | null;
};

export type TeamMatchSummary = {
	id: number;
	eventId: number;
	eventName: string;
	name: string;
	round: number;
	at?: string;
	/** the team-matches endpoint never sets `scored`, so this is derived from the posted scores. */
	played: boolean;
	/** practice rounds are film, but they never count toward a record. */
	practice: boolean;
	color: 'red' | 'blue';
	score: number;
	opponentScore: number;
	margin: number;
	result: MatchResult | null;
	partners: string[];
	opponents: string[];
};

export type TeamAwardSummary = {
	title: string;
	eventId: number | null;
	eventName: string;
	at?: string;
};

export type TeamOverview = {
	team: TeamData;
	record: TeamRecord;
	events: TeamEventSummary[];
	matches: TeamMatchSummary[];
	awards: TeamAwardSummary[];
	skills: TeamSkillsSummary;
	stats: {
		eventCount: number;
		matchesPlayed: number;
		averageScore: number | null;
		highScore: number | null;
		averageMargin: number | null;
		bestRank: number | null;
	};
};

export function formatRecord(record: TeamRecord): string {
	return `${record.wins}-${record.losses}-${record.ties}`;
}

export function winRateLabel(record: TeamRecord): string {
	return record.winRate === null ? '—' : `${Math.round(record.winRate * 100)}%`;
}
