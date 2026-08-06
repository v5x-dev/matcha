export const MAX_CLIP_TITLE_LENGTH = 80;
export const MIN_CLIP_SECONDS = 1;
export const MAX_CLIP_SECONDS = 120;
export const CLIP_LIMIT = 200;

export function isValidClipSpan(startSeconds: number, endSeconds: number): boolean {
	const span = endSeconds - startSeconds;

	return span >= MIN_CLIP_SECONDS && span <= MAX_CLIP_SECONDS;
}

export function canDeleteClip(
	authorId: string,
	actorId: string,
	actorCanModerate: boolean
): boolean {
	return authorId === actorId || actorCanModerate;
}
