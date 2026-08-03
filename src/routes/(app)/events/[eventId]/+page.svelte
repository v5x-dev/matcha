<script lang="ts">
	import { resolve } from '$app/paths';
	import { activeMatchId, MATCH_RESTART_EVENT } from '$lib/match-param.svelte';
	import { orderedEventMatches } from '$lib/match-navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import YoutubeIcon from '$lib/components/youtube-icon.svelte';
	import {
		clearPlaybackOffset,
		saveMatchPlaybackWindow,
		savePlaybackOffset
	} from '$lib/remote/match-playback.remote';
	import { listEventVideos, type EventVideo } from '$lib/remote/video.remote';
	import { groupMatchesByStreamDay, streamDayOf } from '$lib/stream-days';
	import { matchPlayback, type MatchPlayback } from '$lib/video-playback';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ClockArrowLeftIcon from '@lucide/svelte/icons/clock-arrow-left';
	import ClockArrowRightIcon from '@lucide/svelte/icons/clock-arrow-right';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import TimerResetIcon from '@lucide/svelte/icons/timer-reset';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import { watch } from 'runed';
	import { Slider } from 'svelte-awesome-slider';
	import { onDestroy, onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import YoutubePlayer from 'youtube-player';

	type MatchWindow = { startSeconds: number; endSeconds: number };

	const { params, data } = $props();

	const eventId = $derived(Number(params.eventId));
	const event = $derived(data.event);
	const matches = $derived(data.matches);
	const savedMatchStarts = $derived(data.savedMatchStarts);
	const savedMatchWindows = $derived(data.savedMatchWindows);
	const savedPlaybackOffsets = $derived(data.savedPlaybackOffsets);
	const activeMatch = $derived(matches.find((match) => match.id === activeMatchId()) ?? matches[0]);
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
	$effect(() => {
		const currentEventId = eventId;
		if (videoEventId !== currentEventId) {
			videoEventId = null;
			videos = [];
			videoRequest++;
		}

		if (!activeMatch || videoEventId === currentEventId) return;

		videoEventId = currentEventId;
		const request = ++videoRequest;
		void listEventVideos(currentEventId)
			.then((result) => {
				if (request === videoRequest) videos = result.videos;
			})
			.catch(() => {
				if (request === videoRequest) videos = [];
			});
	});
	const playback = $derived(
		activeMatch ? matchPlayback(videos, activeMatch, divisions, matches, streamDays) : null
	);
	// an event streamed over several days has a match on every day that the recording missed, so say
	// so rather than leaving the previous day's film on screen looking like the wrong match
	const missingFilm = $derived(activeMatch !== undefined && playback === null);

	let player: ReturnType<typeof YoutubePlayer> | undefined;
	let loadedVideoId: string | undefined;
	let appliedMatchId = $state<number | null>(null);
	let appliedVideoId = $state<string | null>(null);
	let appliedStartSeconds = $state<number | null>(null);
	let appliedEndSeconds = $state<number | null>(null);
	let currentSeconds = $state(0);
	let sliderSeconds = $state(0);
	let durationSeconds = $state(0);
	let isPlaying = $state(false);
	let isMuted = $state(true);
	let scrubbing = false;
	let loopingMatch = false;
	let progressInterval: ReturnType<typeof setInterval> | undefined;
	let updateSequence = 0;

	// the player iframe is letterboxed to 16:9 here so youtube never paints its own black bars
	let stageWidth = $state(0);
	let stageHeight = $state(0);
	const frameWidth = $derived(Math.min(stageWidth, (stageHeight * 16) / 9));
	const frameHeight = $derived(Math.min(stageHeight, (stageWidth * 9) / 16));
	const matchWindows = new SvelteMap<number, MatchWindow>();
	const playbackOffsets = new SvelteMap<string, number | null>();

	const youtubeUrl = $derived(
		appliedVideoId
			? `https://www.youtube.com/watch?v=${appliedVideoId}&t=${Math.floor(currentSeconds)}s`
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
		const savedStart = savedMatchStarts.find(
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
	const seekMinSeconds = $derived(matchWindow?.startSeconds ?? 0);
	const seekMaxSeconds = $derived(
		matchWindow?.endSeconds ?? Math.max(seekMinSeconds + 1, durationSeconds)
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
	const canSetEnd = $derived(matchWindow !== null && currentSeconds > seekMinSeconds);
	const canResetPlaybackOffset = $derived(
		playback ? hasPlaybackOffset(playback.video.videoId) : false
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

	function clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}

	function matchHref(matchId: number): string {
		return resolve(`/(app)/events/[eventId]?match=${matchId}`, {
			eventId: eventId.toString()
		});
	}

	async function refreshProgress() {
		if (!player) return;

		try {
			const [nextCurrent, nextDuration] = await Promise.all([
				player.getCurrentTime(),
				player.getDuration()
			]);

			if (Number.isFinite(nextDuration) && nextDuration > 0) durationSeconds = nextDuration;

			const currentWindow = matchWindow;
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
		} else {
			await player.playVideo();
			isPlaying = true;
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

	async function restartActiveMatch() {
		if (!player || !matchWindow) return;
		scrubbing = true;
		currentSeconds = matchWindow.startSeconds;
		sliderSeconds = matchWindow.startSeconds;

		try {
			await player.seekTo(matchWindow.startSeconds, true);
			await player.playVideo();
			isPlaying = true;
		} finally {
			scrubbing = false;
		}
	}

	async function setMatchStart() {
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
			() => savedMatchStarts,
			() => savedMatchWindows,
			() => savedPlaybackOffsets
		],
		() => {
			// a match the recordings do not cover must not silently keep another day's film playing
			if (missingFilm) {
				void player?.pauseVideo();
				appliedMatchId = null;
				appliedStartSeconds = null;
				appliedEndSeconds = null;
				return;
			}

			const initialVideo = playback?.video ?? videos[0];
			if (!initialVideo) return;
			loopingMatch = false;

			const initialWindow = activeMatch && playback ? windowFor(activeMatch.id, playback) : null;
			const createdPlayer = !player;

			if (!player) {
				player = YoutubePlayer('youtube-player', {
					videoId: initialVideo.videoId,
					playerVars: {
						controls: 0,
						autoplay: 1,
						playsinline: 1,
						rel: 0,
						start: initialWindow?.startSeconds
					}
				});
				player.on('stateChange', (state) => {
					isPlaying = state.data === 1;
				});
				loadedVideoId = initialVideo.videoId;
				progressInterval = setInterval(() => void refreshProgress(), 500);
			}

			const sequence = ++updateSequence;

			void (async () => {
				if (createdPlayer) {
					await player!.mute();
					isMuted = true;
				}

				if (playback && initialWindow) {
					if (loadedVideoId === playback.video.videoId) {
						await player!.seekTo(initialWindow.startSeconds, true);
					} else {
						loadedVideoId = playback.video.videoId;
						await player!.loadVideoById(playback.video.videoId, initialWindow.startSeconds);
					}
					currentSeconds = initialWindow.startSeconds;
					sliderSeconds = initialWindow.startSeconds;
				}

				await player!.playVideo();

				// A newer click owns the status if player commands from two selections overlap.
				if (sequence === updateSequence) {
					appliedMatchId = playback ? (activeMatch?.id ?? null) : null;
					appliedVideoId = loadedVideoId ?? null;
					appliedStartSeconds = initialWindow?.startSeconds ?? null;
					appliedEndSeconds = initialWindow?.endSeconds ?? null;
				}
			})();
		}
	);

	onMount(() => {
		function handleRestart(event: Event) {
			const matchId = (event as CustomEvent<number>).detail;
			if (matchId === activeMatch?.id) void restartActiveMatch();
		}

		window.addEventListener(MATCH_RESTART_EVENT, handleRestart);
		return () => window.removeEventListener(MATCH_RESTART_EVENT, handleRestart);
	});

	onDestroy(() => {
		updateSequence++;
		if (progressInterval) clearInterval(progressInterval);
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
	class="relative flex h-full w-full flex-col overflow-hidden bg-background"
	id="player"
	data-match-id={appliedMatchId}
	data-video-id={appliedVideoId}
	data-start-seconds={appliedStartSeconds}
	data-end-seconds={appliedEndSeconds}
	data-current-seconds={Math.floor(currentSeconds)}
	data-slider-seconds={Math.floor(sliderSeconds)}
	data-duration-seconds={Math.floor(durationSeconds)}
	data-offset-seconds={playback ? offsetFor(playback.video.videoId) : null}
	data-stream-day={playback?.day?.number ?? null}
	data-stream-day-count={streamDays.length}
	data-missing-film={missingFilm}
>
	<div
		class="flex min-h-0 flex-1 items-center justify-center bg-background"
		bind:clientWidth={stageWidth}
		bind:clientHeight={stageHeight}
	>
		<div style="width: {frameWidth}px; height: {frameHeight}px;">
			<div class="h-full w-full" id="youtube-player"></div>
		</div>
	</div>

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
		class="z-20 m-2 flex items-center gap-2 rounded-xl border border-border bg-card/80 p-3 shadow-lg backdrop-blur-sm"
	>
		<div class="flex shrink-0 items-center gap-0.5">
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
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
							size="icon-xs"
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

		<div class="mx-1 h-4 w-px bg-border"></div>

		<div class="flex shrink-0 items-center gap-0.5">
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							disabled={durationSeconds <= 0}
							onclick={() => void seekViewer(currentSeconds - 5)}
							aria-label="back 5 seconds"
						>
							<RotateCcwIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>back 5 seconds</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							disabled={durationSeconds <= 0}
							onclick={() => void togglePlayback()}
							aria-label={isPlaying ? 'pause' : 'play'}
						>
							{#if isPlaying}<PauseIcon />{:else}<PlayIcon />{/if}
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>{isPlaying ? 'pause' : 'play'}</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							disabled={durationSeconds <= 0}
							onclick={() => void seekViewer(currentSeconds + 5)}
							aria-label="forward 5 seconds"
						>
							<RotateCwIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>forward 5 seconds</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							disabled={durationSeconds <= 0}
							onclick={() => void toggleMute()}
							aria-label={isMuted ? 'unmute' : 'mute'}
						>
							{#if isMuted}<VolumeXIcon />{:else}<Volume2Icon />{/if}
						</Button>
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
							size="icon-xs"
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

			<div class="mx-1 h-4 w-px bg-border"></div>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							disabled={durationSeconds <= 0 ||
								!canSetStart ||
								savePlaybackOffset.pending > 0 ||
								clearPlaybackOffset.pending > 0 ||
								saveMatchPlaybackWindow.pending > 0}
							onclick={() => void setMatchStart()}
							aria-label="set recording offset"
						>
							<ClockArrowLeftIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>set recording offset</Tooltip.Content>
			</Tooltip.Root>

			{#if canResetPlaybackOffset}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								disabled={clearPlaybackOffset.pending > 0 || savePlaybackOffset.pending > 0}
								onclick={() => void resetPlaybackOffset()}
								aria-label="reset recording offset"
							>
								<TimerResetIcon />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>reset recording offset</Tooltip.Content>
				</Tooltip.Root>
			{/if}

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							disabled={durationSeconds <= 0 ||
								!canSetEnd ||
								savePlaybackOffset.pending > 0 ||
								clearPlaybackOffset.pending > 0 ||
								saveMatchPlaybackWindow.pending > 0}
							onclick={() => void setMatchEnd()}
							aria-label="set match end"
						>
							<ClockArrowRightIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>set match end</Tooltip.Content>
			</Tooltip.Root>
		</div>

		<span class="w-11 text-right text-xs font-medium text-muted-foreground">
			{formatTime(currentSeconds)}
		</span>
		<div
			class:pointer-events-none={durationSeconds <= 0}
			class:opacity-50={durationSeconds <= 0}
			class="video-seek flex-1"
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
		<span class="w-11 text-xs font-medium text-muted-foreground">
			{formatTime(seekMaxSeconds)}
		</span>
	</div>
</div>

<style>
	/* youtube-player swaps the mount div for an iframe with its own default dimensions */
	:global(#youtube-player) {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
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
