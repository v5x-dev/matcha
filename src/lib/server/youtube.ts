import { YOUTUBE_API_KEY } from '$env/static/private';
import type { EventData } from 'events.vex';

const API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/;
/** how many distinct channels we are willing to spend search quota on for one event. */
const MAX_CHANNELS = 6;
/** a field broadcast runs for hours; anything shorter is a clip, a short, or a highlights reel. */
const MIN_BROADCAST_SECONDS = 20 * 60;

export type YouTubeReference =
	| { kind: 'video'; id: string; url: string }
	| { kind: 'channel'; id?: string; handle?: string; username?: string; url: string }
	| { kind: 'playlist'; id: string; url: string };

/** where a video came from, ordered by how much we trust it. */
export type VideoSource = 'event-page' | 'webcast-index' | 'youtube-channel';

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
	status?: { privacyStatus?: string; embeddable?: boolean };
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

async function youtubeRequest<T>(path: string, params: Record<string, string>) {
	if (!YOUTUBE_API_KEY) {
		throw new Error('youtube api key is not configured');
	}

	const url = new URL(`${API_BASE_URL}/${path}`);
	url.search = new URLSearchParams({ ...params, key: YOUTUBE_API_KEY }).toString();

	const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	const body = (await response.json()) as ListResponse<T>;

	if (!response.ok) {
		throw new Error(body.error?.message ?? `youtube request failed with ${response.status}`);
	}

	return body;
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
	confidence: number
) {
	const uniqueIds = [...new Set(videoIds)].slice(0, 200);
	const videos: EventVideo[] = [];

	for (let index = 0; index < uniqueIds.length; index += 50) {
		const ids = uniqueIds.slice(index, index + 50);
		const response = await youtubeRequest<YouTubeVideo>('videos', {
			part: 'snippet,contentDetails,status,liveStreamingDetails',
			id: ids.join(',')
		});

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

export async function getPlaylistVideoIds(playlistId: string) {
	const videoIds: string[] = [];
	let pageToken: string | undefined;

	for (let page = 0; page < 4; page += 1) {
		const response = await youtubeRequest<{
			contentDetails?: { videoId?: string };
		}>('playlistItems', {
			part: 'contentDetails',
			playlistId,
			maxResults: '50',
			...(pageToken ? { pageToken } : {})
		});

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
export async function resolveChannelId(reference: YouTubeReference) {
	if (reference.kind !== 'channel') return null;
	if (reference.id) return reference.id;

	const params: Record<string, string> = { part: 'id' };
	if (reference.handle) params.forHandle = reference.handle;
	else if (reference.username) params.forUsername = reference.username;
	else return null;

	const response = await youtubeRequest<{ id?: string }>('channels', params);

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
	maxPages = 10
}: {
	channelId: string;
	publishedAfter: string;
	publishedBefore: string;
	maxPages?: number;
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
			contentDetails?: { videoId?: string; videoPublishedAt?: string };
		}>('playlistItems', {
			part: 'contentDetails',
			playlistId,
			maxResults: '50',
			...(pageToken ? { pageToken } : {})
		});

		let passedWindow = false;

		for (const item of response.items ?? []) {
			const id = item.contentDetails?.videoId;
			if (!id) continue;

			const at = Date.parse(item.contentDetails?.videoPublishedAt ?? '');
			// an undated entry is cheap to hydrate and gets filtered on its own timestamps later
			if (!Number.isFinite(at)) {
				videoIds.push(id);
				continue;
			}

			if (at < after) passedWindow = true;
			else if (at <= before) videoIds.push(id);
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

async function fetchVexPage(url: string) {
	const response = await fetch(url, {
		headers: {
			accept: 'text/html,application/xhtml+xml',
			'user-agent': 'matcha event media indexer/1.0'
		},
		redirect: 'follow',
		signal: AbortSignal.timeout(5_000)
	});

	if (!response.ok) {
		throw new Error(`vex webcast page returned ${response.status}`);
	}

	return response.text();
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
async function discoverVexReferences(event: EventData) {
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
				warnings.push(
					source === 'event-page'
						? 'the vex event page could not be read'
						: 'the vex webcast index could not be read'
				);
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
export async function discoverEventVideos(event: EventData): Promise<EventVideoResult> {
	const { references, warnings } = await discoverVexReferences(event);
	const windows = eventWindows(event);
	const videos: EventVideo[] = [];
	const directBySource = new Map<
		VideoSource,
		{ ids: string[]; urls: Map<string, string>; confidence: number }
	>();
	const channelReferences: DiscoveredReference[] = [];

	for (const reference of references) {
		const parsed = parseYouTubeReference(reference.value);
		if (!parsed) continue;

		if (parsed.kind === 'video') {
			const group = directBySource.get(reference.source) ?? {
				ids: [],
				urls: new Map<string, string>(),
				confidence: reference.confidence
			};
			group.ids.push(parsed.id);
			group.urls.set(parsed.id, reference.sourceUrl);
			directBySource.set(reference.source, group);
		} else if (parsed.kind === 'playlist') {
			try {
				const ids = await getPlaylistVideoIds(parsed.id);
				const urls = new Map(ids.map((id) => [id, reference.sourceUrl]));
				videos.push(...(await getYouTubeVideos(ids, reference.source, urls, reference.confidence)));
			} catch {
				warnings.push('a referenced youtube playlist could not be read');
			}
		} else {
			channelReferences.push(reference);
		}
	}

	for (const [source, group] of directBySource) {
		try {
			videos.push(...(await getYouTubeVideos(group.ids, source, group.urls, group.confidence)));
		} catch {
			warnings.push('a referenced youtube video could not be read');
		}
	}

	const channelIds = new Map<string, DiscoveredReference>();
	for (const reference of channelReferences) {
		try {
			const id = await resolveChannelId(parseYouTubeReference(reference.value)!);
			if (id) channelIds.set(id, reference);
		} catch {
			warnings.push('a referenced youtube channel could not be resolved');
		}
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

	for (const [channelId, reference] of [...channelIds].slice(0, MAX_CHANNELS)) {
		try {
			const ids = await listChannelUploadIds({
				channelId,
				publishedAfter: windows.publishedAfter,
				publishedBefore: windows.publishedBefore
			});
			const urls = new Map(ids.map((id) => [id, reference.sourceUrl]));
			const discovered = await getYouTubeVideos(
				ids,
				'youtube-channel',
				urls,
				Math.min(reference.confidence, 0.92)
			);

			videos.push(
				...discovered.filter(
					(video) =>
						isBroadcast(video) &&
						matchesEventProgram(video.title, event) &&
						(overlapsEvent(video, windows.overlapStart, windows.overlapEnd) ||
							titleScore(video.title, event) >= 0.25)
				)
			);
		} catch {
			warnings.push('additional videos from a referenced youtube channel could not be searched');
		}
	}

	// the window is applied here rather than per source so a stale event-page link still gets its
	// channel searched above, without the stale video itself being served as this event's film
	return {
		videos: dedupeVideos(videos).filter((video) =>
			withinUploadWindow(video, windows.uploadStart, windows.uploadEnd)
		),
		warnings: [...new Set(warnings)]
	};
}
