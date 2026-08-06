<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		activeClipId,
		activeMatchId,
		activeTimeSeconds,
		CLIP_RESTART_EVENT,
		MATCH_RESTART_EVENT,
		MATCH_PARAM,
		TIME_PARAM
	} from '$lib/match-param.svelte';
	import { orderedEventMatches } from '$lib/match-navigation';
	import AuthDialog from '$lib/components/auth-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import { useSidebar } from '$lib/components/ui/sidebar';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import YoutubeIcon from '$lib/components/youtube-icon.svelte';
	import {
		clearPlaybackOffset,
		saveMatchPlaybackStart,
		saveMatchPlaybackWindow,
		savePlaybackOffset
	} from '$lib/remote/match-playback.remote';
	import { createClip, getEventClip, listEventClips } from '$lib/remote/clip.remote';
	import { listEventVideos, type EventVideo } from '$lib/remote/video.remote';
	import {
		isValidClipSpan,
		MAX_CLIP_SECONDS,
		MAX_CLIP_TITLE_LENGTH,
		MIN_CLIP_SECONDS
	} from '$lib/clips';
	import { finishBrowserMetric, startBrowserMetric } from '$lib/client/performance';
	import { groupMatchesByStreamDay, streamDayOf } from '$lib/stream-days';
	import { matchPlayback, type MatchPlayback } from '$lib/video-playback';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ClockArrowLeftIcon from '@lucide/svelte/icons/clock-arrow-left';
	import ClockArrowRightIcon from '@lucide/svelte/icons/clock-arrow-right';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import LinkIcon from '@lucide/svelte/icons/link';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import PanelRightIcon from '@lucide/svelte/icons/panel-right';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import TimerResetIcon from '@lucide/svelte/icons/timer-reset';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import { watch } from 'runed';
	import { Slider } from 'svelte-awesome-slider';
	import { onDestroy, onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type YoutubePlayer from 'youtube-player';

	type MatchWindow = { startSeconds: number; endSeconds: number };

	const { params, data } = $props();
	const eventPage = $derived(await data.eventPage);

	const sidebar = useSidebar();

	const eventId = $derived(Number(params.eventId));
	const event = $derived(eventPage.event);
	const user = $derived(data.user);
	const matches = $derived(eventPage.matches);
	const clipsQuery = $derived(listEventClips(eventId));
	const clips = $derived(clipsQuery.current ?? eventPage.clips);
	const requestedClipId = $derived(activeClipId());
	const requestedClipQuery = $derived(
		requestedClipId ? getEventClip({ eventId, clipId: requestedClipId }) : null
	);
	const savedMatchStarts = $derived(eventPage.savedMatchStarts);
	const savedMatchWindows = $derived(eventPage.savedMatchWindows);
	const savedPlaybackOffsets = $derived(eventPage.savedPlaybackOffsets);
	const requestedClip = $derived(
		requestedClipQuery?.current ?? clips.find((clip) => clip.id === requestedClipId) ?? null
	);
	const activeMatch = $derived(
		matches.find(
			(match) =>
				match.id === activeMatchId() || (!activeMatchId() && match.id === requestedClip?.matchId)
		) ?? matches[0]
	);
	const streamGrouping = $derived(groupMatchesByStreamDay(matches));
	const orderedMatches = $derived(orderedEventMatches(matches, streamGrouping));
	const activeMatchIndex = $derived(
		orderedMatches.findIndex((match) => match.id === activeMatch?.id)
	);
	const previousMatch = $derived(
		activeMatchIndex > 0 ? (orderedMatches[activeMatchIndex - 1] ?? null) : null
	);
	const nextMatch = $derived(
		(activeMatchIndex === -1 ? orderedMatches[0] : orderedMatches[activeMatchIndex + 1]) ?? null
	);
	const divisions = $derived([
		...new Map(matches.map((match) => [match.division.id, match.division])).values()
	]);
	const streamDays = $derived(streamGrouping.days);
	const activeMatchDay = $derived(activeMatch ? streamDayOf(streamDays, activeMatch) : null);

	// scraping the vex pages and the youtube api takes seconds. Only start that work when the event
	// has a match to play; the first match is the default when the url has no selection.
	let videos = $state<EventVideo[]>([]);
	let videoEventId: number | null = null;
	let videoRequest = 0;
	let isDiscoveringVideos = $state(false);
	let videoDiscoveryMetric: ReturnType<typeof startBrowserMetric> | null = null;
	let playableVideoMetric: ReturnType<typeof startBrowserMetric> | null = null;
	$effect(() => {
		const currentEventId = eventId;
		if (videoEventId !== currentEventId) {
			videoEventId = null;
			videos = [];
			videoRequest++;
			isDiscoveringVideos = false;
		}

		if (!activeMatch || videoEventId === currentEventId) return;

		videoEventId = currentEventId;
		const request = ++videoRequest;
		isDiscoveringVideos = true;
		videoDiscoveryMetric = startBrowserMetric('event.video-discovery');
		playableVideoMetric = startBrowserMetric('event.time-to-playable-video');
		void listEventVideos(currentEventId)
			.then((result) => {
				if (request !== videoRequest) return;
				videos = result.videos;
				isDiscoveringVideos = false;
				finishBrowserMetric(videoDiscoveryMetric, {
					resultCount: result.videos.length,
					warningCount: result.warnings.length
				});
				videoDiscoveryMetric = null;
			})
			.catch(() => {
				if (request !== videoRequest) return;
				videos = [];
				isDiscoveringVideos = false;
				finishBrowserMetric(videoDiscoveryMetric, { resultCount: 0, failed: true });
				videoDiscoveryMetric = null;
			});
	});
	const playback = $derived(
		activeMatch ? matchPlayback(videos, activeMatch, divisions, matches, streamDays) : null
	);
	// an event streamed over several days has a match on every day that the recording missed, so say
	// so rather than leaving the previous day's film on screen looking like the wrong match
	const missingFilm = $derived(
		!isDiscoveringVideos && activeMatch !== undefined && playback === null
	);
	const activeClip = $derived(
		requestedClip &&
			activeMatch?.id === requestedClip.matchId &&
			playback?.video.videoId === requestedClip.videoId
			? requestedClip
			: null
	);

	let player: ReturnType<typeof YoutubePlayer> | undefined;
	let loadedVideoId: string | undefined;
	let appliedMatchId = $state<number | null>(null);
	let appliedVideoId = $state<string | null>(null);
	let appliedStartSeconds = $state<number | null>(null);
	let appliedEndSeconds = $state<number | null>(null);
	let appliedClipId = $state<string | null>(null);
	let appliedClipStartSeconds = $state<number | null>(null);
	let appliedClipEndSeconds = $state<number | null>(null);
	let currentSeconds = $state(0);
	let sliderSeconds = $state(0);
	let durationSeconds = $state(0);
	let isPlaying = $state(false);
	let isMuted = $state(true);
	let scrubbing = false;
	let loopingMatch = false;
	let clipStart = $state<number | null>(null);
	let clipEnd = $state<number | null>(null);
	let clipMarkMatchId = $state<number | null>(null);
	let clipMarkVideoId = $state<string | null>(null);
	let clipTitle = $state('');
	let clipAuthOpen = $state(false);
	let progressTimer: ReturnType<typeof setTimeout> | undefined;
	let progressInFlight = false;
	let durationVideoId: string | null = null;
	let updateSequence = 0;

	// the player iframe is letterboxed to 16:9 here so youtube never paints its own black bars
	let stageWidth = $state(0);
	let stageHeight = $state(0);
	let playerShell: HTMLDivElement;
	const frameWidth = $derived(Math.min(stageWidth, (stageHeight * 16) / 9));
	const frameHeight = $derived(Math.min(stageHeight, (stageWidth * 9) / 16));
	const matchWindows = new SvelteMap<number, MatchWindow>();
	const matchStarts = new SvelteMap<number, { videoId: string; startSeconds: number }>();
	const playbackOffsets = new SvelteMap<string, number | null>();

	const youtubeUrl = $derived(
		appliedVideoId
			? `https://www.youtube.com/watch?v=${appliedVideoId}&t=${Math.floor(currentSeconds)}s`
			: null
	);

	const shareUrl = $derived(
		activeMatch
			? resolve(`/(app)/events/[eventId]?match=${activeMatch.id}&t=${Math.floor(currentSeconds)}`, {
					eventId: eventId.toString()
				})
			: null
	);

	/** the correction saved against the recording a match is in — each stream day has its own. */
	function offsetFor(videoId: string): number {
		if (playbackOffsets.has(videoId)) return playbackOffsets.get(videoId) ?? 0;

		return savedPlaybackOffsets.find((offset) => offset.videoId === videoId)?.offsetSeconds ?? 0;
	}

	function hasPlaybackOffset(videoId: string): boolean {
		if (playbackOffsets.has(videoId)) return playbackOffsets.get(videoId) !== null;
		return savedPlaybackOffsets.some((offset) => offset.videoId === videoId);
	}

	function windowFor(matchId: number, currentPlayback: MatchPlayback): MatchWindow {
		const offsetSeconds = offsetFor(currentPlayback.video.videoId);
		const videoEndSeconds = currentPlayback.video.durationSeconds ?? Number.POSITIVE_INFINITY;
		const localStart = matchStarts.get(matchId);
		const savedStart =
			(localStart?.videoId === currentPlayback.video.videoId ? localStart : undefined) ??
			savedMatchStarts.find(
				(start) => start.matchId === matchId && start.videoId === currentPlayback.video.videoId
			);
		const startSeconds = clamp(
			savedStart?.startSeconds ?? currentPlayback.startSeconds + offsetSeconds,
			0,
			Math.max(0, videoEndSeconds - 1)
		);
		const local = matchWindows.get(matchId);
		const saved =
			local ??
			savedMatchWindows.find(
				(window) => window.matchId === matchId && window.videoId === currentPlayback.video.videoId
			);
		const endSeconds = Math.min(
			saved?.endSeconds ?? currentPlayback.endSeconds + offsetSeconds,
			videoEndSeconds
		);

		return { startSeconds, endSeconds: Math.max(startSeconds + 1, endSeconds) };
	}

	const matchWindow = $derived.by(() => {
		if (!activeMatch || !playback) return null;
		return windowFor(activeMatch.id, playback);
	});
	const clipWindow = $derived(
		activeClip
			? { startSeconds: activeClip.startSeconds, endSeconds: activeClip.endSeconds }
			: matchWindow
	);
	const seekMinSeconds = $derived(clipWindow?.startSeconds ?? 0);
	const seekMaxSeconds = $derived(
		clipWindow?.endSeconds ?? Math.max(seekMinSeconds + 1, durationSeconds)
	);
	const calibrationMinSeconds = $derived(matchWindow?.startSeconds ?? 0);
	const calibrationMaxSeconds = $derived(
		matchWindow?.endSeconds ?? Math.max(calibrationMinSeconds + 1, durationSeconds)
	);
	const seekPosition = $derived(
		Math.max(
			0,
			Math.min(100, ((sliderSeconds - seekMinSeconds) / (seekMaxSeconds - seekMinSeconds)) * 100)
		)
	);
	const canSetStart = $derived(
		matchWindow !== null && currentSeconds >= 0 && currentSeconds < durationSeconds
	);
	const canSetEnd = $derived(matchWindow !== null && currentSeconds > calibrationMinSeconds);
	const canResetPlaybackOffset = $derived(
		playback ? hasPlaybackOffset(playback.video.videoId) : false
	);
	const boundsSpanSeconds = $derived(Math.max(0, calibrationMaxSeconds - calibrationMinSeconds));
	// the calibration bar spans the match window rather than the whole recording: a match is a couple
	// of minutes inside a stream that runs for hours, so window-relative is the only readable scale.
	const boundsPlayhead = $derived(
		boundsSpanSeconds > 0
			? clamp(((currentSeconds - calibrationMinSeconds) / boundsSpanSeconds) * 100, 0, 100)
			: 0
	);
	const isPlayheadInBounds = $derived(
		durationSeconds > 0 &&
			currentSeconds >= calibrationMinSeconds &&
			currentSeconds <= calibrationMaxSeconds
	);
	const clipSpanSeconds = $derived(
		clipStart !== null && clipEnd !== null ? clipEnd - clipStart : null
	);
	const canSaveClip = $derived(
		activeMatch !== undefined &&
			playback !== null &&
			clipMarkMatchId === activeMatch.id &&
			clipMarkVideoId === playback.video.videoId &&
			clipStart !== null &&
			clipEnd !== null &&
			isValidClipSpan(clipStart, clipEnd) &&
			clipTitle.trim().length <= MAX_CLIP_TITLE_LENGTH
	);

	function formatTime(value: number): string {
		const total = Math.max(0, Math.floor(value));
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor((total % 3600) / 60);
		const seconds = (total % 60).toString().padStart(2, '0');

		return hours > 0
			? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds}`
			: `${minutes}:${seconds}`;
	}

	function formatOffset(value: number): string {
		return `${value >= 0 ? '+' : '−'}${formatTime(Math.abs(value))}`;
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}

	function reasonFrom(error: unknown, fallback: string): string {
		const body = (error as { body?: { message?: string } } | undefined)?.body;
		if (body?.message) return body.message.toLowerCase();
		if (error instanceof Error && error.message) return error.message.toLowerCase();
		return fallback;
	}

	function showCalibrationError(error: unknown) {
		toast.error('calibration could not be saved', {
			description: reasonFrom(error, 'an unexpected error occurred')
		});
	}

	function saveCalibration(action: () => Promise<void>) {
		void action().catch(showCalibrationError);
	}

	function clearClipMarks() {
		clipStart = null;
		clipEnd = null;
		clipMarkMatchId = null;
		clipMarkVideoId = null;
	}

	async function markClipIn() {
		if (!activeMatch || !playback) return;
		const matchId = activeMatch.id;
		const videoId = playback.video.videoId;
		const playerSeconds = player ? await player.getCurrentTime().catch(() => undefined) : undefined;
		if (activeMatch?.id !== matchId || playback?.video.videoId !== videoId) return;
		if (clipMarkMatchId !== activeMatch.id || clipMarkVideoId !== playback.video.videoId) {
			clearClipMarks();
		}
		clipMarkMatchId = matchId;
		clipMarkVideoId = videoId;
		clipStart = Math.max(0, Math.floor(playerSeconds ?? currentSeconds));
	}

	async function markClipOut() {
		if (!activeMatch || !playback) return;
		const matchId = activeMatch.id;
		const videoId = playback.video.videoId;
		const playerSeconds = player ? await player.getCurrentTime().catch(() => undefined) : undefined;
		if (activeMatch?.id !== matchId || playback?.video.videoId !== videoId) return;
		if (clipMarkMatchId !== activeMatch.id || clipMarkVideoId !== playback.video.videoId) {
			clearClipMarks();
		}
		clipMarkMatchId = matchId;
		clipMarkVideoId = videoId;
		clipEnd = Math.max(0, Math.floor(playerSeconds ?? currentSeconds));
	}

	async function saveClip() {
		if (!canSaveClip || !activeMatch || !playback || clipStart === null || clipEnd === null) return;
		const title =
			clipTitle.trim() ||
			activeMatch.name.trim().toLowerCase().slice(0, MAX_CLIP_TITLE_LENGTH) ||
			'clip';

		try {
			await createClip({
				eventId,
				matchId: activeMatch.id,
				videoId: playback.video.videoId,
				title,
				startSeconds: clipStart,
				endSeconds: clipEnd
			});
			clearClipMarks();
			clipTitle = '';
			await clipsQuery.refresh();
			toast.success('clip saved');
		} catch (error) {
			toast.error('clip could not be saved', {
				description: reasonFrom(error, 'an unexpected error occurred')
			});
		}
	}

	$effect(() => {
		const currentMatchId = activeMatch?.id ?? null;
		const currentVideoId = playback?.video.videoId ?? null;
		if (
			(clipMarkMatchId !== null || clipMarkVideoId !== null) &&
			(clipMarkMatchId !== currentMatchId || clipMarkVideoId !== currentVideoId)
		) {
			clearClipMarks();
		}
	});

	function stopProgressPolling() {
		if (progressTimer) clearTimeout(progressTimer);
		progressTimer = undefined;
	}

	function scheduleProgressPolling() {
		stopProgressPolling();
		if (!player || document.hidden || !isPlaying) return;
		progressTimer = setTimeout(() => void refreshProgress(), 500);
	}

	function matchHref(matchId: number): string {
		return resolve(`/(app)/events/[eventId]?match=${matchId}`, {
			eventId: eventId.toString()
		});
	}

	function clearActiveClip() {
		if (!activeMatch) return;
		void goto(
			resolve(`/(app)/events/[eventId]?match=${activeMatch.id}`, {
				eventId: eventId.toString()
			}),
			{ replaceState: true, keepFocus: true, noScroll: true }
		);
	}

	async function refreshProgress() {
		if (!player || progressInFlight || document.hidden || !isPlaying) return;
		progressInFlight = true;

		try {
			const nextCurrent = await player.getCurrentTime();

			const currentWindow = clipWindow;
			if (
				!scrubbing &&
				!loopingMatch &&
				isPlaying &&
				currentWindow &&
				Number.isFinite(nextCurrent) &&
				nextCurrent >= currentWindow.endSeconds
			) {
				const sequence = updateSequence;
				loopingMatch = true;
				currentSeconds = currentWindow.startSeconds;
				sliderSeconds = currentWindow.startSeconds;

				try {
					await player.seekTo(currentWindow.startSeconds, true);
					if (sequence === updateSequence) await player.playVideo();
				} finally {
					loopingMatch = false;
				}
				return;
			}

			if (!scrubbing && Number.isFinite(nextCurrent)) {
				currentSeconds = nextCurrent;
				sliderSeconds = clamp(nextCurrent, seekMinSeconds, seekMaxSeconds);
			}
		} catch {
			// The iframe can disappear while its final progress request is in flight.
		} finally {
			progressInFlight = false;
			scheduleProgressPolling();
		}
	}

	async function loadDurationFor(videoId: string) {
		if (!player || durationVideoId === videoId) return;
		durationVideoId = videoId;
		try {
			const duration = await player.getDuration();
			if (Number.isFinite(duration) && duration > 0) durationSeconds = duration;
		} catch {
			// duration is best effort; the controls remain usable without it.
		}
	}

	function previewSeek(value: number) {
		scrubbing = true;
		sliderSeconds = value;
		currentSeconds = value;
	}

	async function commitSeek(value: number) {
		const target = clamp(value, seekMinSeconds, seekMaxSeconds);
		sliderSeconds = target;
		currentSeconds = target;

		try {
			await player?.seekTo(target, true);
		} finally {
			scrubbing = false;
		}
	}

	function commitPreview() {
		if (!scrubbing) return;
		void commitSeek(sliderSeconds);
	}

	async function seekViewer(value: number) {
		const target = clamp(value, 0, Math.max(0, durationSeconds));
		scrubbing = true;
		currentSeconds = target;
		sliderSeconds = clamp(target, seekMinSeconds, seekMaxSeconds);

		try {
			await player?.seekTo(target, true);
		} finally {
			scrubbing = false;
		}
	}

	async function togglePlayback() {
		if (!player) return;
		if (isPlaying) {
			await player.pauseVideo();
			isPlaying = false;
			scheduleProgressPolling();
		} else {
			await player.playVideo();
			isPlaying = true;
			scheduleProgressPolling();
		}
	}

	async function toggleMute() {
		if (!player) return;
		if (isMuted) {
			await player.unMute();
			isMuted = false;
		} else {
			await player.mute();
			isMuted = true;
		}
	}

	async function toggleFullscreen() {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
			return;
		}

		await playerShell.requestFullscreen();
	}

	async function copyShareLink() {
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			toast.success('share link copied');
		} catch {
			toast.error('could not copy the share link');
		}
	}

	async function restartActiveMatch() {
		if (!player || !clipWindow) return;
		scrubbing = true;
		currentSeconds = clipWindow.startSeconds;
		sliderSeconds = clipWindow.startSeconds;

		try {
			await player.seekTo(clipWindow.startSeconds, true);
			await player.playVideo();
			isPlaying = true;
			scheduleProgressPolling();
		} finally {
			scrubbing = false;
		}
	}

	async function setPlaybackOffsetHere() {
		if (!activeMatch || !matchWindow || !playback) return;
		const videoId = playback.video.videoId;
		const playerSeconds = await player?.getCurrentTime();
		const nextStart = Math.max(0, Math.floor(playerSeconds ?? currentSeconds));

		const saved = await savePlaybackOffset({
			eventId,
			matchId: activeMatch.id,
			videoId,
			offsetSeconds: nextStart - playback.startSeconds
		});
		playbackOffsets.set(saved.videoId, saved.offsetSeconds);

		const nextWindow = windowFor(activeMatch.id, playback);
		appliedStartSeconds = nextWindow.startSeconds;
		appliedEndSeconds = nextWindow.endSeconds;
		sliderSeconds = clamp(currentSeconds, nextWindow.startSeconds, nextWindow.endSeconds);
	}

	async function setMatchStart() {
		if (!activeMatch || !matchWindow || !playback) return;
		const matchId = activeMatch.id;
		const videoId = playback.video.videoId;
		const playerSeconds = await player?.getCurrentTime();
		const startSeconds = Math.max(0, Math.floor(playerSeconds ?? currentSeconds));

		const saved = await saveMatchPlaybackStart({ eventId, matchId, videoId, startSeconds });
		matchStarts.set(matchId, saved);

		if (activeMatch?.id === matchId && playback?.video.videoId === videoId) {
			const nextWindow = windowFor(matchId, playback);
			appliedStartSeconds = nextWindow.startSeconds;
			appliedEndSeconds = nextWindow.endSeconds;
			sliderSeconds = clamp(currentSeconds, nextWindow.startSeconds, nextWindow.endSeconds);
		}
	}

	async function resetPlaybackOffset() {
		if (!playback) return;
		const videoId = playback.video.videoId;
		await clearPlaybackOffset({ eventId, videoId });
		playbackOffsets.set(videoId, null);

		if (activeMatch) {
			const nextWindow = windowFor(activeMatch.id, playback);
			appliedStartSeconds = nextWindow.startSeconds;
			appliedEndSeconds = nextWindow.endSeconds;
			sliderSeconds = clamp(currentSeconds, nextWindow.startSeconds, nextWindow.endSeconds);
		}
	}

	async function setMatchEnd() {
		if (!activeMatch || !matchWindow || !playback) return;
		const matchId = activeMatch.id;
		const videoId = playback.video.videoId;
		const playerSeconds = await player?.getCurrentTime();
		const nextEnd = Math.min(
			Math.ceil(playerSeconds ?? currentSeconds),
			Math.max(1, durationSeconds)
		);
		if (nextEnd <= matchWindow.startSeconds) return;

		const saved = await saveMatchPlaybackWindow({
			eventId,
			matchId,
			videoId,
			startSeconds: matchWindow.startSeconds,
			endSeconds: nextEnd
		});
		matchWindows.set(matchId, saved);

		if (activeMatch?.id === matchId && playback?.video.videoId === videoId) {
			appliedEndSeconds = saved.endSeconds;
			sliderSeconds = clamp(currentSeconds, saved.startSeconds, saved.endSeconds);
		}
	}

	watch(
		[
			() => videos,
			() => playback,
			() => activeMatch,
			() => activeTimeSeconds(),
			() => savedMatchStarts,
			() => savedMatchWindows,
			() => savedPlaybackOffsets,
			() => activeClip?.id,
			() => activeClip?.startSeconds,
			() => activeClip?.endSeconds
		],
		() => {
			// a match the recordings do not cover must not silently keep another day's film playing
			if (missingFilm) {
				updateSequence++;
				stopProgressPolling();
				void player?.pauseVideo();
				appliedMatchId = null;
				appliedClipId = null;
				appliedClipStartSeconds = null;
				appliedClipEndSeconds = null;
				appliedStartSeconds = null;
				appliedEndSeconds = null;
				return;
			}

			const initialVideo = playback?.video ?? videos[0];
			if (!initialVideo) return;
			loopingMatch = false;

			const initialWindow = activeMatch && playback ? clipWindow : null;
			const requestedTimeSeconds = activeTimeSeconds();
			const initialSeek =
				initialWindow &&
				requestedTimeSeconds !== null &&
				requestedTimeSeconds >= initialWindow.startSeconds &&
				requestedTimeSeconds <= initialWindow.endSeconds
					? requestedTimeSeconds
					: initialWindow?.startSeconds;
			const sequence = ++updateSequence;

			void (async () => {
				let createdPlayer = false;
				if (!player) {
					const { default: createYoutubePlayer } = await import('youtube-player');
					if (sequence !== updateSequence) return;
					player = createYoutubePlayer('youtube-player', {
						videoId: initialVideo.videoId,
						playerVars: {
							controls: 0,
							autoplay: 1,
							playsinline: 1,
							rel: 0,
							start: initialSeek
						}
					});
					createdPlayer = true;
					loadedVideoId = initialVideo.videoId;
					player.on('stateChange', (state) => {
						if (state.data === 1) isPlaying = true;
						if (state.data === 0 || state.data === 2 || state.data === 5) isPlaying = false;
						scheduleProgressPolling();
						if (state.data === 1) {
							finishBrowserMetric(playableVideoMetric, { videoId: loadedVideoId ?? null });
							playableVideoMetric = null;
						}
					});
				}

				if (createdPlayer) {
					await player!.mute();
					isMuted = true;
				}

				if (playback && initialWindow) {
					if (loadedVideoId === playback.video.videoId) {
						await player!.seekTo(initialSeek!, true);
					} else {
						durationVideoId = null;
						durationSeconds = 0;
						loadedVideoId = playback.video.videoId;
						await player!.loadVideoById(playback.video.videoId, initialSeek ?? 0);
					}
					currentSeconds = initialSeek ?? 0;
					sliderSeconds = initialSeek ?? 0;
				}

				if (loadedVideoId) await loadDurationFor(loadedVideoId);
				await player!.playVideo();
				scheduleProgressPolling();

				// A newer click owns the status if player commands from two selections overlap.
				if (sequence === updateSequence) {
					appliedMatchId = playback ? (activeMatch?.id ?? null) : null;
					appliedVideoId = loadedVideoId ?? null;
					appliedStartSeconds = matchWindow?.startSeconds ?? null;
					appliedEndSeconds = matchWindow?.endSeconds ?? null;
					appliedClipId = activeClip?.id ?? null;
					appliedClipStartSeconds = activeClip?.startSeconds ?? null;
					appliedClipEndSeconds = activeClip?.endSeconds ?? null;
				}
			})();
		}
	);

	onMount(() => {
		function handleRestart(event: Event) {
			const matchId = (event as CustomEvent<number>).detail;
			if (matchId === activeMatch?.id) void restartActiveMatch();
		}

		function handleClipRestart(event: Event) {
			const clipId = (event as CustomEvent<string>).detail;
			if (clipId === activeClip?.id) void restartActiveMatch();
		}

		window.addEventListener(MATCH_RESTART_EVENT, handleRestart);
		window.addEventListener(CLIP_RESTART_EVENT, handleClipRestart);
		function handleVisibilityChange() {
			scheduleProgressPolling();
		}

		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			window.removeEventListener(MATCH_RESTART_EVENT, handleRestart);
			window.removeEventListener(CLIP_RESTART_EVENT, handleClipRestart);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

	onDestroy(() => {
		updateSequence++;
		stopProgressPolling();
		void player?.destroy();
	});
</script>

<svelte:window
	onmouseup={commitPreview}
	ontouchend={commitPreview}
	onkeyup={commitPreview}
	onblur={commitPreview}
/>

<svelte:head>
	<title>{event.name.split(':')[0].toLowerCase()} · matcha</title>
</svelte:head>

<div
	class="player-shell group relative flex h-full w-full flex-col overflow-hidden bg-background"
	id="player"
	bind:this={playerShell}
	data-match-id={appliedMatchId}
	data-video-id={appliedVideoId}
	data-start-seconds={appliedStartSeconds}
	data-end-seconds={appliedEndSeconds}
	data-clip-id={appliedClipId}
	data-clip-start-seconds={appliedClipStartSeconds}
	data-clip-end-seconds={appliedClipEndSeconds}
	data-current-seconds={Math.floor(currentSeconds)}
	data-slider-seconds={Math.floor(sliderSeconds)}
	data-duration-seconds={Math.floor(durationSeconds)}
	data-offset-seconds={playback ? offsetFor(playback.video.videoId) : null}
	data-stream-day={playback?.day?.number ?? null}
	data-stream-day-count={streamDays.length}
	data-missing-film={missingFilm}
>
	<h1 class="sr-only">{event.name.toLowerCase()}</h1>
	<div
		class="relative flex min-h-0 flex-1 items-center justify-center bg-background"
		bind:clientWidth={stageWidth}
		bind:clientHeight={stageHeight}
	>
		<button
			type="button"
			class="absolute inset-0 z-0 border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
			disabled={durationSeconds <= 0 || isDiscoveringVideos || missingFilm}
			onclick={() => void togglePlayback()}
			aria-label={isPlaying ? 'pause video' : 'play video'}
		></button>
		<div class="relative z-10" style="width: {frameWidth}px; height: {frameHeight}px;">
			<div class="h-full w-full" id="youtube-player"></div>
		</div>
	</div>

	{#if isDiscoveringVideos}
		<div
			class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-background/90 text-center"
			aria-live="polite"
		>
			<p class="text-sm font-medium text-foreground">finding event film...</p>
			<p class="text-xs text-muted-foreground">checking the event webcast and youtube</p>
		</div>
	{/if}

	{#if missingFilm}
		<div
			class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-background/90 text-center"
		>
			<p class="text-sm font-medium text-foreground">
				no film for {activeMatch?.name?.toLowerCase()}
			</p>
			<p class="text-xs text-muted-foreground">
				{activeMatchDay && streamDays.length > 1
					? `no ${activeMatchDay.label} recording reaches this match`
					: 'no recording covers this match'}
			</p>
		</div>
	{/if}
	<div
		class="playback-overlay pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-x-2 gap-y-3 px-4 pt-24 pb-4 sm:px-6 sm:pt-32 sm:pb-6"
	>
		<div class="order-1 flex min-w-0 flex-1 items-end justify-between gap-4">
			<div class="min-w-0">
				<p class="truncate text-sm font-semibold">
					{activeMatch?.name.toLowerCase() ?? 'event film'}
				</p>
				<p class="truncate text-xs text-muted-foreground">
					{event.name.split(':')[0].toLowerCase()}
				</p>
			</div>
			<span class="shrink-0 text-xs text-muted-foreground">
				{formatTime(currentSeconds)} / {formatTime(seekMaxSeconds)}
			</span>
		</div>

		<div class="order-4 ml-auto flex shrink-0 items-center gap-0.5">
			<Button
				variant="ghost"
				size="icon-sm"
				class="md:hidden"
				onclick={() => sidebar.toggle()}
				aria-label="toggle matches"
			>
				<PanelRightIcon />
			</Button>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							class="inline-flex"
							href={previousMatch ? matchHref(previousMatch.id) : undefined}
							disabled={!previousMatch}
							aria-label="previous match"
						>
							<ChevronLeftIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>previous match</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							class="inline-flex"
							href={nextMatch ? matchHref(nextMatch.id) : undefined}
							disabled={!nextMatch}
							aria-label="next match"
						>
							<ChevronRightIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>next match</Tooltip.Content>
			</Tooltip.Root>
		</div>

		<div class="order-3 flex shrink-0 items-center gap-0.5">
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<span {...props} class="inline-flex">
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={durationSeconds <= 0}
								onclick={() => void seekViewer(currentSeconds - 5)}
								aria-label="back 5 seconds"
							>
								<RotateCcwIcon />
							</Button>
						</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>back 5 seconds</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<span {...props} class="inline-flex">
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={durationSeconds <= 0}
								onclick={() => void togglePlayback()}
								aria-label={isPlaying ? 'pause' : 'play'}
							>
								{#if isPlaying}<PauseIcon />{:else}<PlayIcon />{/if}
							</Button>
						</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>{isPlaying ? 'pause' : 'play'}</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<span {...props} class="inline-flex">
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={durationSeconds <= 0}
								onclick={() => void seekViewer(currentSeconds + 5)}
								aria-label="forward 5 seconds"
							>
								<RotateCwIcon />
							</Button>
						</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>forward 5 seconds</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<span {...props} class="inline-flex">
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={durationSeconds <= 0}
								onclick={() => void toggleMute()}
								aria-label={isMuted ? 'unmute' : 'mute'}
							>
								{#if isMuted}<VolumeXIcon />{:else}<Volume2Icon />{/if}
							</Button>
						</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>{isMuted ? 'unmute' : 'mute'}</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							href={youtubeUrl ?? undefined}
							disabled={!youtubeUrl}
							{...youtubeUrl ? { target: '_blank', rel: 'noreferrer' } : {}}
							aria-label="youtube"
						>
							<YoutubeIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>youtube</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							class="inline-flex"
							disabled={!shareUrl}
							onclick={() => void copyShareLink()}
							aria-label="share this moment"
						>
							<LinkIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>share this moment</Tooltip.Content>
			</Tooltip.Root>

			<Popover.Root>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							disabled={durationSeconds <= 0 || isDiscoveringVideos || missingFilm}
							aria-label="calibration"
						>
							<SlidersHorizontalIcon />
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content align="start" class="w-88 gap-0 p-0">
					<Popover.Header class="gap-0 p-4 pb-3">
						<div class="flex items-start gap-2.5">
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
							>
								<SlidersHorizontalIcon class="size-4" />
							</span>
							<div class="flex min-w-0 flex-col gap-0.5">
								<Popover.Title>calibration</Popover.Title>
								<Popover.Description class="text-xs">
									align the recording to the active match
								</Popover.Description>
							</div>
						</div>
						<div
							class="mt-3 flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2"
						>
							<span class="text-xs text-muted-foreground">playhead</span>
							<span class="text-sm font-medium">{formatTime(currentSeconds)}</span>
						</div>
						<p class="mt-2 text-xs text-muted-foreground">
							every action below applies at the playhead
						</p>
					</Popover.Header>

					<div class="flex flex-col gap-3 border-t border-border/60 p-4">
						<div class="flex items-center justify-between gap-3">
							<div class="flex min-w-0 flex-col gap-0.5">
								<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									recording offset
								</p>
								<p class="text-xs text-muted-foreground">applies to every match in this stream</p>
							</div>
							<span
								class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {canResetPlaybackOffset
									? 'bg-primary/15 text-primary'
									: 'bg-muted text-muted-foreground'}"
							>
								{playback ? formatOffset(offsetFor(playback.video.videoId)) : '+0:00'}
							</span>
						</div>
						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								class="flex-1"
								disabled={durationSeconds <= 0 || !canSetStart || savePlaybackOffset.pending > 0}
								onclick={() => saveCalibration(setPlaybackOffsetHere)}
							>
								<ClockArrowLeftIcon /> align to playhead
							</Button>
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<span {...props} class="inline-flex">
											<Button
												variant="ghost"
												size="icon-sm"
												class="text-muted-foreground"
												disabled={!canResetPlaybackOffset || clearPlaybackOffset.pending > 0}
												onclick={() => saveCalibration(resetPlaybackOffset)}
												aria-label="reset offset"
											>
												<TimerResetIcon />
											</Button>
										</span>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>reset offset</Tooltip.Content>
							</Tooltip.Root>
						</div>
					</div>

					<div class="flex flex-col gap-3 border-t border-border/60 p-4">
						<div class="flex items-center justify-between gap-3">
							<div class="flex min-w-0 flex-col gap-0.5">
								<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									match bounds
								</p>
								<p class="text-xs text-muted-foreground">trim this match to the action</p>
							</div>
							<span
								class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
							>
								{formatTime(boundsSpanSeconds)}
							</span>
						</div>
						<div class="flex flex-col gap-2">
							<div class="relative h-1.5 w-full rounded-full bg-muted">
								{#if isPlayheadInBounds}
									<div
										class="absolute inset-y-0 left-0 rounded-full bg-primary/60"
										style="width: {boundsPlayhead}%;"
									></div>
									<div
										class="absolute -top-1 -ml-px h-3.5 w-0.5 rounded-full bg-foreground"
										style="left: {boundsPlayhead}%;"
									></div>
								{/if}
							</div>
							<div class="flex items-baseline justify-between gap-3 text-xs">
								<span class="text-muted-foreground">
									start <span class="ml-0.5 font-medium text-foreground">
										{formatTime(calibrationMinSeconds)}
									</span>
								</span>
								<span class="text-muted-foreground">
									<span class="mr-0.5 font-medium text-foreground">
										{formatTime(calibrationMaxSeconds)}
									</span> end
								</span>
							</div>
							{#if durationSeconds > 0 && !isPlayheadInBounds}
								<p class="text-xs text-muted-foreground">the playhead sits outside these bounds</p>
							{/if}
						</div>
						<div class="grid grid-cols-2 gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={durationSeconds <= 0 ||
									!canSetStart ||
									saveMatchPlaybackStart.pending > 0}
								onclick={() => saveCalibration(setMatchStart)}
							>
								<ClockArrowLeftIcon /> set start
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={durationSeconds <= 0 || !canSetEnd || saveMatchPlaybackWindow.pending > 0}
								onclick={() => saveCalibration(setMatchEnd)}
							>
								<ClockArrowRightIcon /> set end
							</Button>
						</div>
					</div>
				</Popover.Content>
			</Popover.Root>

			<Popover.Root>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							disabled={durationSeconds <= 0 || isDiscoveringVideos || missingFilm}
							aria-label="create clip"
						>
							<ScissorsIcon />
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content align="start" class="w-88 gap-0 p-0">
					<Popover.Header class="gap-0 p-4 pb-3">
						<div class="flex items-start gap-2.5">
							<div class="flex min-w-0 flex-1 items-start gap-2.5">
								<span
									class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
								>
									<ScissorsIcon class="size-4" />
								</span>
								<div class="flex min-w-0 flex-col gap-0.5">
									<Popover.Title>save a clip</Popover.Title>
									<Popover.Description class="text-xs">
										mark a short moment from this match
									</Popover.Description>
								</div>
							</div>
							{#if activeClip}
								<Button
									variant="ghost"
									size="sm"
									class="h-7 shrink-0 px-2 text-xs"
									onclick={clearActiveClip}
								>
									play full match
								</Button>
							{/if}
						</div>
						<div
							class="mt-3 flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2"
						>
							<span class="text-xs text-muted-foreground">playhead</span>
							<span class="text-sm font-medium">{formatTime(currentSeconds)}</span>
						</div>
					</Popover.Header>

					<div class="flex flex-col gap-3 border-t border-border/60 p-4">
						<div class="grid grid-cols-2 gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={durationSeconds <= 0 || isDiscoveringVideos || missingFilm}
								onclick={markClipIn}
							>
								<ClockArrowLeftIcon /> mark in
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={durationSeconds <= 0 || isDiscoveringVideos || missingFilm}
								onclick={markClipOut}
							>
								<ClockArrowRightIcon /> mark out
							</Button>
						</div>

						<div class="rounded-lg bg-muted/60 px-3 py-2 text-xs">
							<div class="flex items-center justify-between gap-2">
								<span class="text-muted-foreground">clip span</span>
								<span class="font-medium">
									{clipSpanSeconds === null
										? 'mark in and out'
										: formatTime(Math.max(0, clipSpanSeconds))}
								</span>
							</div>
							<p class="mt-1 text-muted-foreground">
								between {formatTime(MIN_CLIP_SECONDS)} and {formatTime(MAX_CLIP_SECONDS)}
							</p>
						</div>

						<Input
							bind:value={clipTitle}
							maxlength={MAX_CLIP_TITLE_LENGTH}
							placeholder={activeMatch?.name.toLowerCase() ?? 'clip title'}
							aria-label="clip title"
						/>

						{#if user}
							<Button
								size="sm"
								disabled={!canSaveClip || createClip.pending > 0}
								onclick={() => void saveClip()}
							>
								{createClip.pending > 0 ? 'saving clip...' : 'save clip'}
							</Button>
						{:else}
							<div class="flex flex-col gap-2">
								<p class="text-xs text-muted-foreground">sign in to save a public clip</p>
								<Button size="sm" variant="outline" onclick={() => (clipAuthOpen = true)}>
									sign in to save clip
								</Button>
							</div>
						{/if}
					</div>
				</Popover.Content>
			</Popover.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							disabled={durationSeconds <= 0 || isDiscoveringVideos || missingFilm}
							onclick={() => void toggleFullscreen()}
							aria-label="full screen"
						>
							<ExpandIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>full screen</Tooltip.Content>
			</Tooltip.Root>
		</div>

		<div
			class:pointer-events-none={durationSeconds <= 0}
			class:opacity-50={durationSeconds <= 0}
			class="video-seek order-2 w-full"
			style:--seek-position={`${seekPosition}%`}
		>
			<Slider
				bind:value={sliderSeconds}
				min={seekMinSeconds}
				max={seekMaxSeconds}
				step={1}
				keyboardOnly={durationSeconds <= 0}
				onInput={previewSeek}
				ariaLabel="video seek"
				ariaValueText={formatTime}
			/>
		</div>
	</div>
</div>

<AuthDialog bind:open={clipAuthOpen} />

<style>
	/* youtube-player swaps the mount div for an iframe with its own default dimensions */
	:global(#youtube-player) {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
	}

	.playback-overlay {
		/* eased alpha ramp so the scrim fades out instead of ending on a visible edge */
		--scrim-ramp: linear-gradient(
			to top,
			color-mix(in oklab, var(--background) 80%, transparent) 0%,
			color-mix(in oklab, var(--background) 71%, transparent) 10%,
			color-mix(in oklab, var(--background) 62%, transparent) 20%,
			color-mix(in oklab, var(--background) 53%, transparent) 30%,
			color-mix(in oklab, var(--background) 44%, transparent) 40%,
			color-mix(in oklab, var(--background) 35%, transparent) 50%,
			color-mix(in oklab, var(--background) 26%, transparent) 60%,
			color-mix(in oklab, var(--background) 18%, transparent) 70%,
			color-mix(in oklab, var(--background) 11%, transparent) 80%,
			color-mix(in oklab, var(--background) 5%, transparent) 90%,
			transparent 100%
		);
		opacity: 0;
		transform: translateY(0.5rem);
		transition:
			opacity 180ms ease,
			transform 180ms ease;
	}

	/* the ramp and its dither live behind the controls so they never tint the buttons */
	.playback-overlay::before,
	.playback-overlay::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
	}

	.playback-overlay::before {
		background: var(--scrim-ramp);
	}

	/* fine grayscale grain breaks up the 8-bit banding the long alpha ramp would otherwise show */
	.playback-overlay::after {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
		background-size: 160px 160px;
		opacity: 0.04;
		mask-image: var(--scrim-ramp);
		-webkit-mask-image: var(--scrim-ramp);
	}

	.player-shell:hover .playback-overlay,
	.player-shell:focus-within .playback-overlay {
		pointer-events: auto;
		opacity: 1;
		transform: translateY(0);
	}

	@media (hover: none) {
		.playback-overlay {
			pointer-events: auto;
			opacity: 1;
			transform: translateY(0);
		}
	}

	.video-seek {
		--track-width: 100%;
		--track-height: 0.25rem;
		--track-background: var(--input);
		--thumb-size: 1rem;
		--thumb-background: var(--background);
		--thumb-border: 1px solid color-mix(in oklab, var(--foreground) 10%, transparent);
		--focus-color: transparent;
		--margin-block: 0;
	}

	.video-seek :global(.track) {
		background: linear-gradient(
			to right,
			var(--primary) 0 var(--seek-position),
			color-mix(in oklab, var(--input) 90%, transparent) var(--seek-position) 100%
		);
	}

	.video-seek :global(.thumb) {
		box-shadow:
			0 4px 6px -1px color-mix(in oklab, var(--foreground) 10%, transparent),
			0 2px 4px -2px color-mix(in oklab, var(--foreground) 10%, transparent);
		transition:
			box-shadow 200ms,
			color 200ms;
	}

	.video-seek :global(.slider:hover .thumb),
	.video-seek :global(.slider:focus-visible .thumb) {
		box-shadow: 0 0 0 4px color-mix(in oklab, var(--ring) 30%, transparent);
	}
</style>
