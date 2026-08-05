import { get } from 'node:https';
import { YOUTUBE_API_KEY } from '$env/static/private';
import type { EventData } from 'events.vex';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { eventVideo, eventVideoSync } from './db/schema';
import { measureExternalRequest, recordServerTiming } from './instrumentation';

const API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/;
/** how many distinct channels we are willing to spend search quota on for one event. */
const MAX_CHANNELS = 6;
const MAX_YOUTUBE_REQUESTS = 20;
const MAX_CHANNEL_UPLOAD_PAGES = 6;
const VIDEO_CACHE_TTL = 15 * 60 * 1000;
/** a cache miss is cheaper than making the player wait on an unhealthy remote database. */
const VIDEO_CACHE_TIMEOUT_MS = 1_000;
/** a field broadcast runs for hours; anything shorter is a clip, a short, or a highlights reel. */
const MIN_BROADCAST_SECONDS = 20 * 60;

export type YouTubeReference =
	| { kind: 'video'; id: string; url: string }
	| { kind: 'channel'; id?: string; handle?: string; username?: string; url: string }
	| { kind: 'playlist'; id: string; url: string };

/** where a video came from, ordered by how much we trust it. */
export type VideoSource = 'event-page' | 'webcast-index' | 'youtube-channel' | 'youtube-search';

export type EventVideo = {
	videoId: string;
	url: string;
	title: string;
	channelId: string;
	channelTitle: string;
	thumbnailUrl?: string;
	publishedAt?: string;
	actualStartTime?: string;
	actualEndTime?: string;
	scheduledStartTime?: string;
	durationSeconds?: number;
	broadcastStatus: 'upcoming' | 'live' | 'complete';
	source: VideoSource;
	/** the page or channel the video was discovered through. */
	sourceUrl: string;
	confidence: number;
};

export type EventVideoResult = {
	videos: EventVideo[];
	warnings: string[];
};

type DiscoveredReference = {
	value: string;
	source: VideoSource;
	sourceUrl: string;
	confidence: number;
};

/** a title test plus a key identifying it, so coalesced requests only share an identical filter. */
type TitleFilter = {
	key: string;
	test: (title: string) => boolean;
};

type DiscoveryMetrics = {
	youtubeRequests: number;
	cacheLookups: number;
	cacheHits: number;
	resultCount: number;
	warnings: number;
};

type DiscoveryContext = {
	metrics: DiscoveryMetrics;
	warnings: string[];
};

class YouTubeRequestBudgetExceeded extends Error {
	constructor() {
		super('youtube discovery request budget exceeded');
	}
}

const pendingEventDiscoveries = new Map<number, Promise<EventVideoResult>>();
const pendingChannelUploads = new Map<string, Promise<string[]>>();

async function withVideoCacheTimeout<T>(operation: Promise<T>) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error('video cache operation timed out')),
					VIDEO_CACHE_TIMEOUT_MS
				);
			})
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

type YouTubeThumbnail = { url?: string };

type YouTubeVideo = {
	id: string;
	snippet?: {
		title?: string;
		channelId?: string;
		channelTitle?: string;
		publishedAt?: string;
		liveBroadcastContent?: 'none' | 'upcoming' | 'live';
		thumbnails?: Record<string, YouTubeThumbnail>;
	};
	contentDetails?: { duration?: string };
	liveStreamingDetails?: {
		actualStartTime?: string;
		actualEndTime?: string;
		scheduledStartTime?: string;
		scheduledEndTime?: string;
	};
};

type ListResponse<T> = {
	items?: T[];
	nextPageToken?: string;
	error?: { message?: string };
};

function discoveryContext(): DiscoveryContext {
	return {
		metrics: {
			youtubeRequests: 0,
			cacheLookups: 0,
			cacheHits: 0,
			resultCount: 0,
			warnings: 0
		},
		warnings: []
	};
}

function addWarning(context: DiscoveryContext, warning: string) {
	if (!context.warnings.includes(warning)) context.warnings.push(warning);
	context.metrics.warnings = context.warnings.length;
}

function cacheTtl(event: EventData) {
	if (event.ongoing) return 5 * 60 * 1000;
	const end = event.end ? Date.parse(event.end) : NaN;
	return Number.isFinite(end) && end > Date.now() - 2 * 24 * 60 * 60 * 1000
		? VIDEO_CACHE_TTL
		: 24 * 60 * 60 * 1000;
}

async function readEventVideoCache(event: EventData, allowStale = false) {
	try {
		return await withVideoCacheTimeout(
			(async () => {
				const [sync] = await db
					.select({
						syncedAt: eventVideoSync.syncedAt,
						resultCount: eventVideoSync.resultCount,
						warnings: eventVideoSync.warnings
					})
					.from(eventVideoSync)
					.where(eq(eventVideoSync.eventId, event.id));
				const failedWithoutVideos = sync?.resultCount === 0 && sync.warnings.length > 0;
				if (
					!sync ||
					(!allowStale &&
						(failedWithoutVideos || Date.now() - sync.syncedAt.getTime() >= cacheTtl(event)))
				)
					return null;

				const rows = await db
					.select({ data: eventVideo.data })
					.from(eventVideo)
					.where(eq(eventVideo.eventId, event.id));

				return {
					videos: rows.map((row) => row.data),
					warnings: sync.warnings ?? []
				};
			})()
		);
	} catch (error) {
		console.error(`event ${event.id} video cache unavailable; discovering videos upstream`, error);
		return null;
	}
}

async function writeEventVideoCache(eventId: number, result: EventVideoResult) {
	const cachedAt = new Date();
	await db.transaction(async (tx) => {
		await tx.delete(eventVideo).where(eq(eventVideo.eventId, eventId));
		if (result.videos.length > 0) {
			await tx.insert(eventVideo).values(
				result.videos.map((video) => ({
					eventId,
					videoId: video.videoId,
					data: video,
					cachedAt
				}))
			);
		}
		await tx
			.insert(eventVideoSync)
			.values({
				eventId,
				syncedAt: cachedAt,
				resultCount: result.videos.length,
				warnings: result.warnings
			})
			.onConflictDoUpdate({
				target: eventVideoSync.eventId,
				set: {
					syncedAt: cachedAt,
					resultCount: result.videos.length,
					warnings: result.warnings
				}
			});
	});
}

function recordDiscoveryTiming(
	startedAt: number,
	eventId: number,
	metrics: DiscoveryMetrics,
	cacheHit: boolean,
	resultCount: number,
	warnings: string[]
) {
	recordServerTiming('video.discovery', performance.now() - startedAt, {
		eventId,
		cacheHit,
		youtubeRequests: metrics.youtubeRequests,
		youtubeCacheHitRate: metrics.cacheLookups === 0 ? 0 : metrics.cacheHits / metrics.cacheLookups,
		resultCount,
		warningCount: warnings.length,
		warnings: warnings.join(' | ')
	});
}

function withScheme(value: string) {
	const trimmed = value.trim();
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** classify a youtube url as a video, playlist, or channel. `null` when it is neither. */
export function parseYouTubeReference(value: string): YouTubeReference | null {
	let url: URL;

	try {
		url = new URL(withScheme(value));
	} catch {
		return null;
	}

	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	const parts = url.pathname.split('/').filter(Boolean);

	if (host === 'youtu.be') {
		const id = parts[0];
		return id && VIDEO_ID_PATTERN.test(id)
			? { kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` }
			: null;
	}

	if (!['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
		return null;
	}

	const queryVideoId = url.searchParams.get('v');
	if (queryVideoId && VIDEO_ID_PATTERN.test(queryVideoId)) {
		return {
			kind: 'video',
			id: queryVideoId,
			url: `https://www.youtube.com/watch?v=${queryVideoId}`
		};
	}

	if (
		['live', 'embed', 'shorts'].includes(parts[0] ?? '') &&
		VIDEO_ID_PATTERN.test(parts[1] ?? '')
	) {
		const id = parts[1];
		return { kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` };
	}

	const playlistId = url.searchParams.get('list');
	if (playlistId) {
		return {
			kind: 'playlist',
			id: playlistId,
			url: `https://www.youtube.com/playlist?list=${playlistId}`
		};
	}

	if ((parts[0] ?? '').startsWith('@')) {
		return {
			kind: 'channel',
			handle: parts[0],
			url: `https://www.youtube.com/${parts[0]}`
		};
	}

	if (parts[0] === 'channel' && CHANNEL_ID_PATTERN.test(parts[1] ?? '')) {
		return {
			kind: 'channel',
			id: parts[1],
			url: `https://www.youtube.com/channel/${parts[1]}`
		};
	}

	if (parts[0] === 'user' && parts[1]) {
		return {
			kind: 'channel',
			username: parts[1],
			url: `https://www.youtube.com/user/${parts[1]}`
		};
	}

	if (parts[0] === 'c' && parts[1]) {
		return {
			kind: 'channel',
			handle: parts[1],
			url: `https://www.youtube.com/c/${parts[1]}`
		};
	}

	return null;
}

async function youtubeRequest<T>(
	path: string,
	params: Record<string, string>,
	context?: DiscoveryContext
) {
	if (!YOUTUBE_API_KEY) {
		throw new Error('youtube api key is not configured');
	}
	if (context && context.metrics.youtubeRequests >= MAX_YOUTUBE_REQUESTS) {
		throw new YouTubeRequestBudgetExceeded();
	}
	if (context) context.metrics.youtubeRequests += 1;

	const url = new URL(`${API_BASE_URL}/${path}`);
	url.search = new URLSearchParams({ ...params, key: YOUTUBE_API_KEY }).toString();

	return measureExternalRequest(
		`youtube.${path}`,
		async () => {
			const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			const body = (await response.json()) as ListResponse<T>;

			if (!response.ok) {
				throw new Error(body.error?.message ?? `youtube request failed with ${response.status}`);
			}

			return body;
		},
		{ path }
	);
}

function parseDuration(value?: string) {
	if (!value) return undefined;
	const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
	if (!match) return undefined;

	return (
		Number(match[1] ?? 0) * 86_400 +
		Number(match[2] ?? 0) * 3_600 +
		Number(match[3] ?? 0) * 60 +
		Number(match[4] ?? 0)
	);
}

function bestThumbnail(video: YouTubeVideo) {
	const thumbnails = video.snippet?.thumbnails;
	return thumbnails?.maxres?.url ?? thumbnails?.standard?.url ?? thumbnails?.high?.url;
}

function toEventVideo(
	video: YouTubeVideo,
	source: VideoSource,
	sourceUrl: string,
	confidence: number
): EventVideo | null {
	const snippet = video.snippet;
	const live = video.liveStreamingDetails;

	if (!snippet || !snippet.channelId) return null;

	const broadcastStatus =
		snippet.liveBroadcastContent === 'live'
			? 'live'
			: snippet.liveBroadcastContent === 'upcoming'
				? 'upcoming'
				: 'complete';

	return {
		videoId: video.id,
		url: `https://www.youtube.com/watch?v=${video.id}`,
		title: snippet.title ?? 'youtube video',
		channelId: snippet.channelId,
		channelTitle: snippet.channelTitle ?? 'youtube',
		thumbnailUrl: bestThumbnail(video),
		publishedAt: snippet.publishedAt,
		actualStartTime: live?.actualStartTime,
		actualEndTime: live?.actualEndTime,
		scheduledStartTime: live?.scheduledStartTime,
		durationSeconds: parseDuration(video.contentDetails?.duration),
		broadcastStatus,
		source,
		sourceUrl,
		confidence
	};
}

/** hydrate video ids into full video records, 50 at a time as the api allows. */
export async function getYouTubeVideos(
	videoIds: string[],
	source: VideoSource,
	sourceUrlByVideoId: Map<string, string>,
	confidence: number,
	context?: DiscoveryContext
) {
	const uniqueIds = [...new Set(videoIds)].slice(0, 200);
	const videos: EventVideo[] = [];

	for (let index = 0; index < uniqueIds.length; index += 50) {
		const ids = uniqueIds.slice(index, index + 50);
		const response = await youtubeRequest<YouTubeVideo>(
			'videos',
			{
				// nothing reads `status`, and every part asked for is more of a response to parse
				part: 'snippet,contentDetails,liveStreamingDetails',
				id: ids.join(',')
			},
			context
		);

		for (const video of response.items ?? []) {
			const hydrated = toEventVideo(
				video,
				source,
				sourceUrlByVideoId.get(video.id) ?? `https://www.youtube.com/watch?v=${video.id}`,
				confidence
			);

			if (hydrated) videos.push(hydrated);
		}
	}

	return videos;
}

export async function getPlaylistVideoIds(playlistId: string, context?: DiscoveryContext) {
	const videoIds: string[] = [];
	let pageToken: string | undefined;

	for (let page = 0; page < 4; page += 1) {
		const response = await youtubeRequest<{
			contentDetails?: { videoId?: string };
		}>(
			'playlistItems',
			{
				part: 'contentDetails',
				playlistId,
				maxResults: '50',
				...(pageToken ? { pageToken } : {})
			},
			context
		);

		for (const item of response.items ?? []) {
			const id = item.contentDetails?.videoId;
			if (id) videoIds.push(id);
		}

		pageToken = response.nextPageToken;
		if (!pageToken) break;
	}

	return videoIds;
}

/** turn a handle or legacy username into a channel id. `null` when the reference is not a channel. */
export async function resolveChannelId(reference: YouTubeReference, context?: DiscoveryContext) {
	if (reference.kind !== 'channel') return null;
	if (reference.id) return reference.id;

	const params: Record<string, string> = { part: 'id' };
	if (reference.handle) params.forHandle = reference.handle;
	else if (reference.username) params.forUsername = reference.username;
	else return null;

	const response = await youtubeRequest<{ id?: string }>('channels', params, context);

	return response.items?.[0]?.id ?? null;
}

/**
 * a channel's uploads within a date window, newest first.
 *
 * this reads the channel's uploads playlist rather than `search.list` because a search costs a
 * hundred quota units against a daily allowance of the same size — one multi-day event would spend
 * the entire day's budget looking for its second stream, and every event opened afterwards would
 * come back with only the videos its vex page happened to link. a playlist page costs one unit, and
 * the playlist is ordered, so paging stops as soon as it runs past the window.
 */
export async function listChannelUploadIds({
	channelId,
	publishedAfter,
	publishedBefore,
	maxPages = MAX_CHANNEL_UPLOAD_PAGES,
	keepTitle,
	context
}: {
	channelId: string;
	publishedAfter: string;
	publishedBefore: string;
	maxPages?: number;
	keepTitle?: TitleFilter;
	context?: DiscoveryContext;
}) {
	const requestKey = `${channelId}:${publishedAfter}:${publishedBefore}:${maxPages}:${keepTitle?.key ?? ''}`;
	const pending = pendingChannelUploads.get(requestKey);
	if (pending) return pending;

	const request = listChannelUploadIdsUncoalesced({
		channelId,
		publishedAfter,
		publishedBefore,
		maxPages,
		keepTitle,
		context
	});
	pendingChannelUploads.set(requestKey, request);
	try {
		return await request;
	} finally {
		if (pendingChannelUploads.get(requestKey) === request) pendingChannelUploads.delete(requestKey);
	}
}

async function listChannelUploadIdsUncoalesced({
	channelId,
	publishedAfter,
	publishedBefore,
	maxPages,
	keepTitle,
	context
}: {
	channelId: string;
	publishedAfter: string;
	publishedBefore: string;
	maxPages: number;
	keepTitle?: TitleFilter;
	context?: DiscoveryContext;
}) {
	// the uploads playlist of a channel is its id with the channel prefix swapped for the playlist one
	if (!CHANNEL_ID_PATTERN.test(channelId)) return [];

	const playlistId = `UU${channelId.slice(2)}`;
	const after = Date.parse(publishedAfter);
	const before = Date.parse(publishedBefore);
	const videoIds: string[] = [];
	let pageToken: string | undefined;

	for (let page = 0; page < maxPages; page += 1) {
		const response = await youtubeRequest<{
			snippet?: { title?: string };
			contentDetails?: { videoId?: string; videoPublishedAt?: string };
		}>(
			'playlistItems',
			{
				// a playlist page costs the same with or without titles, and a title read here saves a
				// whole hydration request for every fifty uploads it rules out
				part: `contentDetails${keepTitle ? ',snippet' : ''}`,
				playlistId,
				maxResults: '50',
				...(pageToken ? { pageToken } : {})
			},
			context
		);

		let passedWindow = false;

		for (const item of response.items ?? []) {
			const id = item.contentDetails?.videoId;
			if (!id) continue;

			const at = Date.parse(item.contentDetails?.videoPublishedAt ?? '');
			const dated = Number.isFinite(at);

			// a date outside the window ends the page walk even when the title would have been kept
			if (dated && at < after) {
				passedWindow = true;
				continue;
			}
			if (dated && at > before) continue;

			// an untitled entry is cheap to hydrate and gets judged on the video's own title later
			if (keepTitle && item.snippet?.title && !keepTitle.test(item.snippet.title)) continue;

			videoIds.push(id);
		}

		pageToken = response.nextPageToken;
		if (!pageToken || passedWindow) break;
	}

	return videoIds;
}

function decodeHtml(value: string) {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&#x2F;', '/')
		.replaceAll('&#47;', '/')
		.replaceAll('\\u0026', '&')
		.replaceAll('\\/', '/');
}

/** every distinct youtube url embedded anywhere in a page, markup and inline json alike. */
export function extractYouTubeUrls(html: string) {
	const decoded = decodeHtml(html);
	const matches = decoded.match(
		/https?:\/\/(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s"'<>\\]+/gi
	);

	return [...new Set((matches ?? []).map((value) => value.replace(/[),.;]+$/, '')))].filter(
		(value) => parseYouTubeReference(value)
	);
}

/** video ids embedded in youtube's search response, including results with no visible watch link. */
export function extractYouTubeVideoIds(html: string) {
	const matches = html.matchAll(/"videoId":"([\w-]{11})"/g);
	return [...new Set([...matches].map((match) => match[1]))];
}

const VEX_PAGE_TIMEOUT_MS = 10_000;
const VEX_PAGE_HEADERS = {
	accept: 'text/html,application/xhtml+xml',
	// cloudflare answers a request carrying no user-agent at all with the challenge, whatever client
	// asked, so the honest one we would have sent anyway has to be sent
	'user-agent': 'matcha event media indexer/1.0'
};

/**
 * the vex pages sit behind a cloudflare bot check that turns away `fetch` — undici — on the shape of
 * its connection rather than on anything in the request, so no combination of headers gets through
 * it. node's own http/1.1 client is let past with the same headers, and is the only reason these
 * pages are readable; http/2 is refused as well, so this must stay on `node:https`.
 */
function fetchOverHttp1(url: string, deadline: number, redirectsLeft = 5): Promise<string> {
	const remaining = deadline - Date.now();
	if (remaining <= 0) return Promise.reject(new Error('vex webcast page timed out'));

	return new Promise((resolve, reject) => {
		const request = get(url, { headers: VEX_PAGE_HEADERS, timeout: remaining }, (response) => {
			const status = response.statusCode ?? 0;
			const location = response.headers.location;

			// the sku url redirects to the event's program path, so a redirect is the normal case here
			if (status >= 300 && status < 400 && location) {
				response.resume();
				if (redirectsLeft === 0) {
					reject(new Error('vex webcast page redirected too many times'));
					return;
				}
				resolve(fetchOverHttp1(new URL(location, url).toString(), deadline, redirectsLeft - 1));
				return;
			}

			if (status < 200 || status >= 300) {
				response.resume();
				reject(new Error(`vex webcast page returned ${status}`));
				return;
			}

			let body = '';
			response.setEncoding('utf8');
			response.on('data', (chunk) => (body += chunk));
			response.on('end', () => resolve(body));
			response.on('error', reject);
		});

		request.on('timeout', () => request.destroy(new Error('vex webcast page timed out')));
		request.on('error', reject);
	});
}

async function fetchVexPage(url: string) {
	return measureExternalRequest(
		'vex.webcast.page',
		() => fetchOverHttp1(url, Date.now() + VEX_PAGE_TIMEOUT_MS),
		{ url }
	);
}

async function fetchYouTubeSearchPage(query: string) {
	return measureExternalRequest(
		'youtube.search.page',
		async () => {
			const url = new URL('https://www.youtube.com/results');
			url.searchParams.set('search_query', query);
			const response = await fetch(url, {
				headers: {
					accept: 'text/html,application/xhtml+xml',
					'user-agent': 'matcha event media indexer/1.0'
				},
				redirect: 'follow',
				signal: AbortSignal.timeout(5_000)
			});

			if (!response.ok) throw new Error(`youtube search returned ${response.status}`);

			return response.text();
		},
		{ query }
	);
}

/**
 * the webcast index lists every event, so narrow to the table row holding our sku before scraping —
 * otherwise every other event's stream comes back too.
 */
function sliceWebcastRow(html: string, sku: string) {
	const skuIndex = html.indexOf(sku);
	if (skuIndex === -1) return '';

	const rowStart = html.lastIndexOf('<tr', skuIndex);
	const rowEnd = html.indexOf('</tr>', skuIndex);

	return rowStart >= 0 && rowEnd >= 0
		? html.slice(rowStart, rowEnd + 5)
		: html.slice(Math.max(0, skuIndex - 500), skuIndex + 1_500);
}

/** youtube urls named by the vex event page and the vex webcast index. */
async function discoverVexReferences(event: EventData, context: DiscoveryContext) {
	const sources = [
		[`https://events.vex.com/${event.sku}.html`, 'event-page', 1],
		['https://events.vex.com/webcasts?program=vex-robotics-competition', 'webcast-index', 0.98]
	] as const;

	const results = await Promise.all(
		sources.map(async ([url, source, confidence]) => {
			const references: DiscoveredReference[] = [];
			const warnings: string[] = [];

			try {
				const html = await fetchVexPage(url);
				const scoped = source === 'webcast-index' ? sliceWebcastRow(html, event.sku) : html;

				for (const value of extractYouTubeUrls(scoped)) {
					references.push({ value, source, sourceUrl: url, confidence });
				}
			} catch {
				const warning =
					source === 'event-page'
						? 'the vex event page could not be read'
						: 'the vex webcast index could not be read';
				warnings.push(warning);
				addWarning(context, warning);
			}

			return { references, warnings };
		})
	);

	return {
		references: results.flatMap((result) => result.references),
		warnings: results.flatMap((result) => result.warnings)
	};
}

function eventWindows(event: EventData) {
	const start = event.start ? Date.parse(event.start) : Date.now() - 24 * 60 * 60 * 1000;
	const end = event.end ? Date.parse(event.end) : start + 24 * 60 * 60 * 1000;

	// a stream goes up while the event runs, so a day of slack on either side covers timezones and
	// the odd late upload without dragging in a channel's unrelated videos
	const uploadStart = start - 24 * 60 * 60 * 1000;
	const uploadEnd = end + 24 * 60 * 60 * 1000;

	return {
		overlapStart: start - 18 * 60 * 60 * 1000,
		overlapEnd: end + 42 * 60 * 60 * 1000,
		uploadStart,
		uploadEnd,
		publishedAfter: new Date(uploadStart).toISOString(),
		publishedBefore: new Date(uploadEnd).toISOString()
	};
}

function videoTime(video: EventVideo) {
	return Date.parse(video.actualStartTime ?? video.scheduledStartTime ?? video.publishedAt ?? '');
}

/**
 * whether a video is a broadcast of the field rather than a clip about it. a channel that merely
 * covers robotics posts shorts and highlights all week; only whoever streamed the event posts hours
 * of it, so this is what separates the event's channel from a media channel that mentioned it.
 */
function isBroadcast(video: EventVideo) {
	if (video.actualStartTime || video.scheduledStartTime) return true;

	return (video.durationSeconds ?? 0) >= MIN_BROADCAST_SECONDS;
}

/**
 * the vex event page keeps last year's webcast link around long after the event, so every video is
 * held to the upload window — a link being on the event page is not evidence it is this year's.
 */
function withinUploadWindow(video: EventVideo, uploadStart: number, uploadEnd: number) {
	const time = videoTime(video);
	if (!Number.isFinite(time)) return false;

	return time >= uploadStart && time <= uploadEnd;
}

function overlapsEvent(video: EventVideo, overlapStart: number, overlapEnd: number) {
	const start = videoTime(video);
	if (!Number.isFinite(start)) return false;

	const end = Date.parse(video.actualEndTime ?? '') || start + (video.durationSeconds ?? 0) * 1000;

	return start <= overlapEnd && end >= overlapStart;
}

// a venue often runs several programs, and one channel broadcasts all of them — a title that
// names another program (and never our own) belongs to a different event
const PROGRAM_PATTERNS = {
	V5RC: /\b(?:v5rc|vrc|vex\s*v5)\b/,
	VURC: /\b(?:vurc|vexu|vex\s*u)\b/,
	VIQRC: /\b(?:viqrc|viqc|vex\s*iq|iq)\b/,
	VAIRC: /\b(?:vairc|vex\s*ai)\b/,
	ADC: /\b(?:adc|aerial\s*drone)\b/
} as const;

const PROGRAM_ALIASES: Record<string, keyof typeof PROGRAM_PATTERNS> = {
	V5RC: 'V5RC',
	VRC: 'V5RC',
	VURC: 'VURC',
	VEXU: 'VURC',
	VIQRC: 'VIQRC',
	VIQC: 'VIQRC',
	VAIRC: 'VAIRC',
	ADC: 'ADC'
};

// a robotics channel covers first as well as vex, and its ftc uploads land squarely inside the
// event's dates — the date window cannot separate them, only the title can
const RIVAL_PROGRAM_PATTERN =
	/\b(?:ftc|frc|ftcin90|first\s*tech\s*challenge|firsttechchallenge|first\s*robotics(?:\s*competition)?|firstrobotics\w*)\b/;

function matchesEventProgram(title: string, event: EventData) {
	const normalized = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
	const program = PROGRAM_ALIASES[event.program.code?.toUpperCase() ?? ''];

	// a combined broadcast that names our program too is still ours
	if (program && PROGRAM_PATTERNS[program].test(normalized)) return true;
	if (RIVAL_PROGRAM_PATTERN.test(normalized)) return false;

	return !Object.entries(PROGRAM_PATTERNS).some(
		([code, pattern]) => code !== program && pattern.test(normalized)
	);
}

/** the share of distinctive words from the event name that appear in a video title. */
function titleScore(title: string, event: EventData) {
	const ignored = new Set([
		'the',
		'and',
		'for',
		'vex',
		'robotics',
		'competition',
		'event',
		'tournament',
		'2025',
		'2026',
		'2027'
	]);
	const tokens = event.name
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 2 && !ignored.has(token));
	const normalizedTitle = title.toLowerCase();
	if (tokens.length === 0) return 0;

	return tokens.filter((token) => normalizedTitle.includes(token)).length / tokens.length;
}

function dedupeVideos(videos: EventVideo[]) {
	const byId = new Map<string, EventVideo>();

	for (const video of videos) {
		const existing = byId.get(video.videoId);
		if (!existing || video.confidence > existing.confidence) {
			byId.set(video.videoId, video);
		}
	}

	return [...byId.values()].sort((a, b) => videoTime(a) - videoTime(b));
}

/**
 * every youtube video we can tie to an event: the videos and playlists the vex pages link to, plus
 * anything the channels behind those links uploaded around the event's dates.
 *
 * a source that fails becomes a warning rather than an error, so one dead page or a spent api quota
 * still leaves the rest of the results usable.
 */
function warningFor(error: unknown, fallback: string) {
	return error instanceof YouTubeRequestBudgetExceeded
		? 'youtube request budget reached'
		: fallback;
}

function expectedStreamDays(event: EventData) {
	const start = event.start ? Date.parse(event.start) : Date.now();
	const end = event.end ? Date.parse(event.end) : start;
	if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
	return Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1);
}

const SEARCH_STOP_WORDS = new Set([
	'the',
	'and',
	'for',
	'vex',
	'v5rc',
	'vrc',
	'robotics',
	'competition',
	'event',
	'tournament',
	'signature',
	'high',
	'school',
	'middle',
	'elementary',
	'2024',
	'2025',
	'2026',
	'2027'
]);

/** keep the fallback query short enough for youtube to match the stream's actual title. */
function eventSearchQuery(event: EventData) {
	const nameTerms = event.name
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 2 && !SEARCH_STOP_WORDS.has(token))
		.slice(0, 2);
	const venueToken = event.location?.venue
		?.split(/[^a-z0-9]+/i)
		.find((token) => token.length > 2 && token === token.toUpperCase());

	return [...nameTerms, ...(venueToken ? ['at', venueToken.toLowerCase()] : [])].join(' ');
}

function coveredStreamDays(
	videos: EventVideo[],
	event: EventData,
	windows: ReturnType<typeof eventWindows>
) {
	return new Set(
		videos
			.filter(
				(video) =>
					isBroadcast(video) && withinUploadWindow(video, windows.uploadStart, windows.uploadEnd)
			)
			.map((video) => new Date(videoTime(video)).toISOString().slice(0, 10))
	).size;
}

async function discoverEventVideosUncoalesced(
	event: EventData,
	context: DiscoveryContext
): Promise<EventVideoResult> {
	const { references } = await discoverVexReferences(event, context);
	const windows = eventWindows(event);
	const videos: EventVideo[] = [];
	const directBySource = new Map<
		VideoSource,
		{ ids: string[]; urls: Map<string, string>; confidence: number }
	>();
	const playlistReferences: Array<{ id: string; reference: DiscoveredReference }> = [];
	const channelReferences: DiscoveredReference[] = [];
	const uniqueReferences = new Map<string, DiscoveredReference>();

	for (const reference of references) {
		const parsed = parseYouTubeReference(reference.value);
		if (!parsed) continue;
		const key = `${parsed.kind}:${parsed.kind === 'video' || parsed.kind === 'playlist' ? parsed.id : (parsed.id ?? parsed.handle ?? parsed.username ?? reference.value)}`;
		const existing = uniqueReferences.get(key);
		if (!existing || reference.confidence > existing.confidence)
			uniqueReferences.set(key, reference);
	}

	for (const reference of uniqueReferences.values()) {
		const parsed = parseYouTubeReference(reference.value);
		if (!parsed) continue;
		if (parsed.kind === 'video') {
			const group = directBySource.get(reference.source) ?? {
				ids: [],
				urls: new Map<string, string>(),
				confidence: reference.confidence
			};
			if (!group.urls.has(parsed.id)) group.ids.push(parsed.id);
			group.urls.set(parsed.id, reference.sourceUrl);
			directBySource.set(reference.source, group);
		} else if (parsed.kind === 'playlist') {
			playlistReferences.push({ id: parsed.id, reference });
		} else {
			channelReferences.push(reference);
		}
	}

	// Direct links are the most trusted and cheapest route to a usable player. Resolve event-page
	// links before widening to the webcast index or channel uploads.
	const directVideos = await Promise.all(
		(['event-page', 'webcast-index'] as VideoSource[]).map(async (source) => {
			const group = directBySource.get(source);
			if (!group) return [];
			try {
				return await getYouTubeVideos(group.ids, source, group.urls, group.confidence, context);
			} catch (error) {
				addWarning(context, warningFor(error, 'a referenced youtube video could not be read'));
				return [];
			}
		})
	);
	videos.push(...directVideos.flat());

	const playlistVideos = await Promise.all(
		playlistReferences.map(async ({ id, reference }) => {
			try {
				const ids = await getPlaylistVideoIds(id, context);
				const urls = new Map(ids.map((videoId) => [videoId, reference.sourceUrl]));
				return await getYouTubeVideos(ids, reference.source, urls, reference.confidence, context);
			} catch (error) {
				addWarning(context, warningFor(error, 'a referenced youtube playlist could not be read'));
				return [];
			}
		})
	);
	videos.push(...playlistVideos.flat());

	// A one-day event with a direct broadcast is already usable. Channel expansion is reserved for
	// missing direct film or multi-day coverage, which keeps both quota and latency predictable.
	const needsChannelExpansion =
		coveredStreamDays(videos, event, windows) < expectedStreamDays(event);
	if (needsChannelExpansion) {
		const channelIds = new Map<string, DiscoveredReference>();
		const resolvedChannels = await Promise.all(
			channelReferences.map(async (reference) => {
				try {
					const id = await resolveChannelId(parseYouTubeReference(reference.value)!, context);
					return id ? ([id, reference] as const) : null;
				} catch (error) {
					addWarning(
						context,
						warningFor(error, 'a referenced youtube channel could not be resolved')
					);
					return null;
				}
			})
		);
		for (const resolved of resolvedChannels) {
			if (resolved) channelIds.set(...resolved);
		}

		// the channel that broadcast one day of the event usually broadcast the rest, so it is worth
		// searching. a channel that only posted a clip is a media channel and its uploads are not film.
		for (const video of videos) {
			if (channelIds.has(video.channelId) || !isBroadcast(video)) continue;

			channelIds.set(video.channelId, {
				value: video.url,
				source: video.source,
				sourceUrl: `https://www.youtube.com/channel/${video.channelId}`,
				confidence: Math.min(video.confidence, 0.92)
			});
		}

		// the same test the discovered videos are held to below, moved forward onto the playlist titles
		const keepTitle: TitleFilter = {
			key: event.program.code ?? '',
			test: (title) => matchesEventProgram(title, event)
		};

		const channelVideos = await Promise.all(
			[...channelIds].slice(0, MAX_CHANNELS).map(async ([channelId, reference]) => {
				try {
					const ids = await listChannelUploadIds({
						channelId,
						publishedAfter: windows.publishedAfter,
						publishedBefore: windows.publishedBefore,
						keepTitle,
						context
					});
					const urls = new Map(ids.map((id) => [id, reference.sourceUrl]));
					const discovered = await getYouTubeVideos(
						ids,
						'youtube-channel',
						urls,
						Math.min(reference.confidence, 0.92),
						context
					);

					return discovered.filter(
						(video) =>
							isBroadcast(video) &&
							matchesEventProgram(video.title, event) &&
							(overlapsEvent(video, windows.overlapStart, windows.overlapEnd) ||
								titleScore(video.title, event) >= 0.25)
					);
				} catch (error) {
					addWarning(
						context,
						warningFor(
							error,
							'additional videos from a referenced youtube channel could not be searched'
						)
					);
					return [];
				}
			})
		);
		videos.push(...channelVideos.flat());
	}

	// Some older event pages are now protected by a bot check, even though their youtube streams
	// are still public. A normal youtube results page is free to fetch and lets us recover those
	// broadcasts without spending a 100-unit search.list quota request.
	if (videos.length === 0) {
		const query = eventSearchQuery(event);
		if (query) {
			try {
				const html = await fetchYouTubeSearchPage(query);
				const ids = extractYouTubeVideoIds(html).slice(0, 50);
				const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
				const urls = new Map(ids.map((id) => [id, searchUrl]));
				const discovered = await getYouTubeVideos(ids, 'youtube-search', urls, 0.7, context);

				videos.push(
					...discovered.filter(
						(video) =>
							isBroadcast(video) &&
							matchesEventProgram(video.title, event) &&
							overlapsEvent(video, windows.overlapStart, windows.overlapEnd) &&
							titleScore(video.title, event) >= 0.25
					)
				);
			} catch (error) {
				addWarning(context, warningFor(error, 'youtube search could not be read'));
			}
		}
	}

	return {
		videos: dedupeVideos(videos).filter((video) =>
			withinUploadWindow(video, windows.uploadStart, windows.uploadEnd)
		),
		warnings: [...new Set(context.warnings)]
	};
}

/** Discover event film with persistent empty/partial-result caching and in-flight coalescing. */
export async function discoverEventVideos(event: EventData): Promise<EventVideoResult> {
	const startedAt = performance.now();
	const context = discoveryContext();
	context.metrics.cacheLookups = 1;
	const cached = await readEventVideoCache(event);
	if (cached) {
		context.metrics.cacheHits = 1;
		context.metrics.resultCount = cached.videos.length;
		context.warnings.push(...cached.warnings);
		recordDiscoveryTiming(
			startedAt,
			event.id,
			context.metrics,
			true,
			cached.videos.length,
			cached.warnings
		);
		return cached;
	}

	const pending = pendingEventDiscoveries.get(event.id);
	if (pending) return pending;

	const request = (async () => {
		try {
			const result = await discoverEventVideosUncoalesced(event, context);
			context.metrics.resultCount = result.videos.length;
			try {
				await withVideoCacheTimeout(writeEventVideoCache(event.id, result));
			} catch (error) {
				console.error(
					`event ${event.id} video cache write unavailable; returning discovered videos`,
					error
				);
			}
			recordDiscoveryTiming(
				startedAt,
				event.id,
				context.metrics,
				false,
				result.videos.length,
				result.warnings
			);
			return result;
		} catch (error) {
			const stale = await readEventVideoCache(event, true);
			if (stale) {
				const warnings = [
					...new Set([...stale.warnings, 'stale video discovery results are being used'])
				];
				context.metrics.resultCount = stale.videos.length;
				recordDiscoveryTiming(
					startedAt,
					event.id,
					context.metrics,
					false,
					stale.videos.length,
					warnings
				);
				return { videos: stale.videos, warnings };
			}
			recordDiscoveryTiming(startedAt, event.id, context.metrics, false, 0, [String(error)]);
			throw error;
		}
	})();

	pendingEventDiscoveries.set(event.id, request);
	try {
		return await request;
	} finally {
		if (pendingEventDiscoveries.get(event.id) === request) pendingEventDiscoveries.delete(event.id);
	}
}
