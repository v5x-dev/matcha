import { query } from '$app/server';
import { getTeamOverview as loadTeamOverview } from '$lib/server/team-overview';
import type { TeamOverview } from '$lib/team-types';

export const getTeamOverview = query(
	'unchecked',
	async (teamNumber: string): Promise<TeamOverview> => loadTeamOverview(teamNumber)
);
