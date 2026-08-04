import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { match, matchMessage, user } from '$lib/server/db/schema';
import { MAX_MESSAGE_LENGTH, MESSAGE_LIMIT } from '$lib/chat';

export type MatchMessage = {
	id: string;
	body: string;
	createdAt: number;
	authorId: string;
	authorName: string;
};

const matchRef = z.object({
	eventId: z.number().int().positive(),
	matchId: z.number().int().positive()
});

export const listMatchMessages = query(
	matchRef,
	async ({ eventId, matchId }): Promise<MatchMessage[]> => {
		let rows;
		try {
			rows = await db
				.select({
					id: matchMessage.id,
					body: matchMessage.body,
					createdAt: matchMessage.createdAt,
					authorId: user.id,
					authorName: user.name
				})
				.from(matchMessage)
				.innerJoin(user, eq(user.id, matchMessage.userId))
				.where(and(eq(matchMessage.eventId, eventId), eq(matchMessage.matchId, matchId)))
				.orderBy(desc(matchMessage.createdAt))
				.limit(MESSAGE_LIMIT);
		} catch (error) {
			console.error(`match ${matchId} chat unavailable; continuing with an empty chat`, error);
			return [];
		}

		// read newest-first so the limit keeps the *latest* messages, then flip back to reading order
		return rows.reverse().map((row) => ({ ...row, createdAt: row.createdAt.getTime() }));
	}
);

const sendSchema = matchRef.extend({
	body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH)
});

export const sendMatchMessage = command(sendSchema, async (input): Promise<MatchMessage> => {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'sign in to chat');

	// a match id from another event would otherwise file the message under a chat nobody can read
	const [cachedMatch] = await db
		.select({ id: match.id })
		.from(match)
		.where(and(eq(match.id, input.matchId), eq(match.eventId, input.eventId)));

	if (!cachedMatch) error(404, 'match not found');

	const createdAt = new Date();
	const [row] = await db
		.insert(matchMessage)
		.values({
			eventId: input.eventId,
			matchId: input.matchId,
			userId: locals.user.id,
			body: input.body,
			createdAt
		})
		.returning({ id: matchMessage.id });

	const message: MatchMessage = {
		id: row.id,
		body: input.body,
		createdAt: createdAt.getTime(),
		authorId: locals.user.id,
		authorName: locals.user.name
	};

	await listMatchMessages({ eventId: input.eventId, matchId: input.matchId }).refresh();

	return message;
});
