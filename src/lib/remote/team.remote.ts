import { query } from '$app/server';
import { error } from '@sveltejs/kit';
import { programs, type TeamData } from 'events.vex';
import vex from '$lib/server/vex';

export const getTeam = query('unchecked', async (teamNumber: string): Promise<TeamData> => {
	const normalizedNumber = teamNumber.trim().toUpperCase();

	if (!normalizedNumber || normalizedNumber.length > 16) {
		error(404, 'team not found');
	}

	const teamResult = await vex.teams.getByNumber(normalizedNumber, programs.V5RC);
	if (teamResult.error || !teamResult.data) {
		if (teamResult.response.status === 404 || !teamResult.data) error(404, 'team not found');
		error(502, 'team data unavailable');
	}

	return teamResult.data.getData();
});
