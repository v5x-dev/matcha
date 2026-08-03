import { page } from '$app/state';

export const MATCH_PARAM = 'match';
export const MATCH_RESTART_EVENT = 'matcha:restart-match';

/** id of the match currently selected via `?match=`, or null when none is */
export function activeMatchId(): number | null {
	const value = page.url.searchParams.get(MATCH_PARAM);
	if (!value) return null;

	const id = Number(value);
	return Number.isFinite(id) ? id : null;
}

export function requestMatchRestart(id: number) {
	window.dispatchEvent(new CustomEvent<number>(MATCH_RESTART_EVENT, { detail: id }));
}
