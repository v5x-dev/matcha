import { page } from '$app/state';

export const MATCH_PARAM = 'match';
export const MATCH_RESTART_EVENT = 'matcha:restart-match';
export const CLIP_PARAM = 'clip';
export const CLIP_RESTART_EVENT = 'matcha:restart-clip';
export const TIME_PARAM = 't';

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

/** id of the clip currently selected via `?clip=`, or null when none is selected */
export function activeClipId(): string | null {
	return page.url.searchParams.get(CLIP_PARAM);
}

export function requestClipRestart(id: string) {
	window.dispatchEvent(new CustomEvent<string>(CLIP_RESTART_EVENT, { detail: id }));
}

/** the second offset carried via `?t=`, or null when none is */
export function activeTimeSeconds(): number | null {
	const value = page.url.searchParams.get(TIME_PARAM);
	if (!value) return null;

	const seconds = Number(value);
	return Number.isFinite(seconds) ? seconds : null;
}
