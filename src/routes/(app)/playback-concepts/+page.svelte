<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleGaugeIcon from '@lucide/svelte/icons/circle-gauge';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import TimerResetIcon from '@lucide/svelte/icons/timer-reset';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';

	let calibrationMode = $state<'scout' | 'calibrate'>('scout');

	const concepts = [
		{
			number: '01',
			name: 'the broadcast deck',
			tagline: 'familiar, balanced, and immediately readable',
			bestFor: 'best all-rounder'
		},
		{
			number: '02',
			name: 'the match tape',
			tagline: 'turn the recording into a match-first analysis tool',
			bestFor: 'deep scouting'
		},
		{
			number: '03',
			name: 'the twitch overlay',
			tagline: 'keep the film large and let the controls disappear',
			bestFor: 'maximum film'
		},
		{
			number: '04',
			name: 'the scout / calibrate dock',
			tagline: 'separate everyday playback from stream setup',
			bestFor: 'recommended'
		},
		{
			number: '05',
			name: 'the match carousel',
			tagline: 'make moving through consecutive matches the main interaction',
			bestFor: 'rapid review'
		}
	];
	const [concept01, concept02, concept03, concept04, concept05] = concepts;
</script>

<svelte:head>
	<title>playback concepts · matcha</title>
</svelte:head>

<div class="h-full overflow-y-auto bg-background">
	<header class="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
		<div class="mx-auto flex max-w-[92rem] items-center justify-between gap-4 px-5 py-3 sm:px-8">
			<div class="flex items-center gap-3">
				<Button variant="ghost" size="icon-sm" href="/events" aria-label="back to events">
					<ArrowLeftIcon />
				</Button>
				<div>
					<p class="text-sm font-semibold">event playback concepts</p>
					<p class="text-xs text-muted-foreground">five directions for faster film review</p>
				</div>
			</div>
			<Badge variant="outline" class="hidden sm:inline-flex">concept gallery</Badge>
		</div>
	</header>

	<main class="mx-auto max-w-[92rem] px-5 py-10 sm:px-8 sm:py-14">
		<section class="max-w-3xl">
			<p class="mb-3 text-xs font-semibold tracking-[0.18em] text-primary">matcha film room</p>
			<h1 class="text-3xl font-semibold tracking-tight sm:text-5xl">
				five ways to control the tape
			</h1>
			<p class="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
				each direction uses the same match and playback state. what changes is the hierarchy: what
				stays visible, what gets out of the way, and how calibration fits into the workflow.
			</p>
		</section>

		<nav class="mt-8 flex flex-wrap gap-2" aria-label="concepts">
			{#each concepts as concept (concept.number)}
				<a
					href={`#concept-${concept.number}`}
					class="rounded-2xl border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
				>
					{concept.number} · {concept.name}
				</a>
			{/each}
		</nav>

		<div class="mt-12 space-y-16">
			<!-- concept 01 -->
			<section id="concept-01" class="scroll-mt-24">
				<div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
					<div>
						<div class="flex items-center gap-2">
							<span class="text-xs font-semibold text-primary">{concept01.number}</span>
							<h2 class="text-xl font-semibold">{concept01.name}</h2>
						</div>
						<p class="mt-1 text-sm text-muted-foreground">{concept01.tagline}</p>
					</div>
					<Badge variant="secondary">{concept01.bestFor}</Badge>
				</div>

				<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
					<div class="film-stage aspect-video min-h-64">
						<div class="field-mark field-mark-a"></div>
						<div class="field-mark field-mark-b"></div>
						<div class="field-mark field-mark-c"></div>
						<div
							class="absolute top-4 left-4 rounded-lg bg-background/80 px-2 py-1 text-xs font-semibold backdrop-blur-sm"
						>
							qualifier #18
						</div>
					</div>
					<div class="border-t border-border bg-card p-3 sm:p-4">
						<div class="mb-3 flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-semibold">qualifier #18</p>
								<p class="truncate text-xs text-muted-foreground">
									25565a + 4610z vs 16099c + 9039z
								</p>
							</div>
							<span class="shrink-0 text-xs text-muted-foreground">1:58 / 2:15</span>
						</div>
						<div class="timeline"><span style="width: 76%"></span><i style="left: 76%"></i></div>
						<div class="mt-3 flex items-center justify-between gap-3">
							<Button variant="ghost" size="sm"><ChevronLeftIcon /> previous match</Button>
							<div class="flex items-center gap-1">
								<Button variant="ghost" size="icon-sm" aria-label="back 5 seconds"
									><RotateCcwIcon /></Button
								>
								<Button size="icon-lg" aria-label="pause"><PauseIcon /></Button>
								<Button variant="ghost" size="icon-sm" aria-label="forward 5 seconds"
									><RotateCwIcon /></Button
								>
								<Button
									variant="ghost"
									size="icon-sm"
									class="hidden sm:inline-flex"
									aria-label="volume"><Volume2Icon /></Button
								>
							</div>
							<Button variant="ghost" size="sm">next match <ChevronRightIcon /></Button>
						</div>
					</div>
				</div>
			</section>

			<!-- concept 02 -->
			<section id="concept-02" class="scroll-mt-24">
				<div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
					<div>
						<div class="flex items-center gap-2">
							<span class="text-xs font-semibold text-primary">{concept02.number}</span>
							<h2 class="text-xl font-semibold">{concept02.name}</h2>
						</div>
						<p class="mt-1 text-sm text-muted-foreground">{concept02.tagline}</p>
					</div>
					<Badge variant="secondary">{concept02.bestFor}</Badge>
				</div>

				<div class="rounded-2xl border border-border bg-card p-4 shadow-lg sm:p-6">
					<div class="flex items-center justify-between gap-4">
						<Button variant="ghost" size="sm"><ChevronLeftIcon /> qualifier #17</Button>
						<div class="text-center">
							<p class="text-base font-semibold">qualifier #18</p>
							<p class="text-xs text-muted-foreground">1:58 elapsed</p>
						</div>
						<Button variant="ghost" size="sm">qualifier #19 <ChevronRightIcon /></Button>
					</div>

					<div class="mt-8">
						<div class="mb-2 grid grid-cols-[15fr_105fr] text-xs text-muted-foreground">
							<span>auton</span><span class="border-l border-border pl-3">driver control</span>
						</div>
						<div
							class="relative flex h-14 overflow-hidden rounded-xl border border-border bg-muted/35"
						>
							<div class="w-[12.5%] border-r border-border bg-primary/15"></div>
							<div class="tape-ticks relative flex-1"></div>
							<div class="absolute inset-y-0 w-0.5 bg-primary" style="left: 76%">
								<span
									class="absolute -top-2 left-1/2 size-3 -translate-x-1/2 rounded-full bg-primary"
								></span>
							</div>
							<span
								class="absolute bottom-2 left-[76%] -translate-x-1/2 rounded-md bg-background px-1.5 py-0.5 text-xs font-medium shadow-sm"
							>
								1:58
							</span>
						</div>
						<div class="mt-2 flex justify-between text-xs text-muted-foreground">
							<span>0:00</span><span>0:15</span><span>1:00</span><span>2:15</span>
						</div>
					</div>

					<div class="mt-5 flex items-center justify-center gap-1">
						<Button variant="ghost" size="icon-sm" aria-label="restart match"
							><TimerResetIcon /></Button
						>
						<Button variant="ghost" size="icon-sm" aria-label="back 5 seconds"
							><RotateCcwIcon /></Button
						>
						<Button size="icon-lg" aria-label="play"><PlayIcon /></Button>
						<Button variant="ghost" size="icon-sm" aria-label="forward 5 seconds"
							><RotateCwIcon /></Button
						>
						<Button variant="ghost" size="icon-sm" aria-label="match settings"
							><Settings2Icon /></Button
						>
					</div>
				</div>
			</section>

			<!-- concept 03 -->
			<section id="concept-03" class="scroll-mt-24">
				<div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
					<div>
						<div class="flex items-center gap-2">
							<span class="text-xs font-semibold text-primary">{concept03.number}</span>
							<h2 class="text-xl font-semibold">{concept03.name}</h2>
						</div>
						<p class="mt-1 text-sm text-muted-foreground">{concept03.tagline}</p>
					</div>
					<Badge variant="secondary">{concept03.bestFor}</Badge>
				</div>

				<div
					class="film-stage group aspect-video min-h-80 overflow-hidden rounded-2xl border border-border shadow-lg"
				>
					<div class="field-mark field-mark-a"></div>
					<div class="field-mark field-mark-b"></div>
					<div class="field-mark field-mark-c"></div>
					<div
						class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/85 to-transparent p-4 pt-20 sm:p-6 sm:pt-24"
					>
						<div class="flex items-end justify-between gap-4">
							<div>
								<p class="text-sm font-semibold">qualifier #18</p>
								<p class="text-xs text-muted-foreground">highlander summit signature event</p>
							</div>
							<span class="text-xs text-muted-foreground">1:58 / 2:15</span>
						</div>
						<div class="timeline mt-3">
							<span style="width: 76%"></span><i style="left: 76%"></i>
						</div>
						<div class="mt-3 flex items-center justify-between">
							<div class="flex items-center gap-1">
								<Button size="icon-sm" aria-label="pause"><PauseIcon /></Button>
								<Button variant="ghost" size="icon-sm" aria-label="back 5 seconds"
									><RotateCcwIcon /></Button
								>
								<Button variant="ghost" size="icon-sm" aria-label="forward 5 seconds"
									><RotateCwIcon /></Button
								>
								<Button variant="ghost" size="icon-sm" aria-label="volume"><Volume2Icon /></Button>
							</div>
							<div class="flex items-center gap-1">
								<Button variant="ghost" size="sm" class="hidden sm:inline-flex"
									><ChevronLeftIcon /> previous</Button
								>
								<Button variant="ghost" size="sm" class="hidden sm:inline-flex"
									>next <ChevronRightIcon /></Button
								>
								<Button variant="ghost" size="icon-sm" aria-label="more options"
									><EllipsisIcon /></Button
								>
								<Button variant="ghost" size="icon-sm" aria-label="full screen"
									><ExpandIcon /></Button
								>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- concept 04 -->
			<section id="concept-04" class="scroll-mt-24">
				<div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
					<div>
						<div class="flex items-center gap-2">
							<span class="text-xs font-semibold text-primary">{concept04.number}</span>
							<h2 class="text-xl font-semibold">{concept04.name}</h2>
						</div>
						<p class="mt-1 text-sm text-muted-foreground">{concept04.tagline}</p>
					</div>
					<Badge>{concept04.bestFor}</Badge>
				</div>

				<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
					<div class="flex items-center justify-between gap-4 border-b border-border p-3 sm:px-5">
						<div class="flex rounded-xl bg-muted p-1">
							<button
								class:active-mode={calibrationMode === 'scout'}
								class="mode-button"
								onclick={() => (calibrationMode = 'scout')}
							>
								<CircleGaugeIcon /> scout
							</button>
							<button
								class:active-mode={calibrationMode === 'calibrate'}
								class="mode-button"
								onclick={() => (calibrationMode = 'calibrate')}
							>
								<SlidersHorizontalIcon /> calibrate
							</button>
						</div>
						<Badge variant="outline">qualifier #18</Badge>
					</div>

					{#if calibrationMode === 'scout'}
						<div class="p-4 sm:p-6">
							<div class="flex items-center justify-between gap-4">
								<Button variant="ghost" size="sm"><ChevronLeftIcon /> qualifier #17</Button>
								<div class="flex items-center gap-1">
									<Button variant="ghost" size="icon-sm" aria-label="back 5 seconds"
										><RotateCcwIcon /></Button
									>
									<Button size="icon-lg" aria-label="pause"><PauseIcon /></Button>
									<Button variant="ghost" size="icon-sm" aria-label="forward 5 seconds"
										><RotateCwIcon /></Button
									>
								</div>
								<Button variant="ghost" size="sm">qualifier #19 <ChevronRightIcon /></Button>
							</div>
							<div class="mt-5 flex items-center gap-3">
								<span class="text-xs text-muted-foreground">1:58</span>
								<div class="timeline flex-1">
									<span style="width: 76%"></span><i style="left: 76%"></i>
								</div>
								<span class="text-xs text-muted-foreground">2:15</span>
							</div>
						</div>
					{:else}
						<div class="grid gap-5 p-4 sm:grid-cols-2 sm:p-6">
							<div class="rounded-xl border border-border bg-muted/30 p-4">
								<div class="flex items-start justify-between gap-4">
									<div>
										<p class="text-sm font-semibold">recording offset</p>
										<p class="mt-1 text-xs text-muted-foreground">
											align every match in this stream
										</p>
									</div>
									<Badge variant="outline">+1:42</Badge>
								</div>
								<div class="mt-5 flex gap-2">
									<Button size="sm"><FlagIcon /> set here</Button>
									<Button variant="outline" size="sm"><TimerResetIcon /> reset</Button>
								</div>
							</div>
							<div class="rounded-xl border border-border bg-muted/30 p-4">
								<p class="text-sm font-semibold">match bounds</p>
								<p class="mt-1 text-xs text-muted-foreground">qualifier #18 · 1:42:18 to 1:44:33</p>
								<div class="bounds mt-5"><span></span><i></i><b></b></div>
								<div class="mt-4 flex justify-between gap-2">
									<Button variant="outline" size="sm">set start</Button>
									<Button variant="outline" size="sm">set end</Button>
								</div>
							</div>
						</div>
					{/if}
				</div>
			</section>

			<!-- concept 05 -->
			<section id="concept-05" class="scroll-mt-24 pb-10">
				<div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
					<div>
						<div class="flex items-center gap-2">
							<span class="text-xs font-semibold text-primary">{concept05.number}</span>
							<h2 class="text-xl font-semibold">{concept05.name}</h2>
						</div>
						<p class="mt-1 text-sm text-muted-foreground">{concept05.tagline}</p>
					</div>
					<Badge variant="secondary">{concept05.bestFor}</Badge>
				</div>

				<div class="overflow-hidden rounded-2xl border border-border bg-card py-6 shadow-lg">
					<div class="carousel-track">
						<div class="match-card side-card">
							<p class="text-xs text-muted-foreground">previous</p>
							<p class="mt-1 text-sm font-semibold">qualifier #17</p>
							<p class="mt-5 text-xs text-muted-foreground">89 · 64</p>
						</div>
						<div class="match-card active-card">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="text-xs font-medium text-primary">now playing</p>
									<p class="mt-1 text-lg font-semibold">qualifier #18</p>
								</div>
								<Button variant="ghost" size="icon-xs" aria-label="more options"
									><EllipsisIcon /></Button
								>
							</div>
							<p class="mt-1 text-xs text-muted-foreground">25565a + 4610z vs 16099c + 9039z</p>
							<div class="timeline mt-6">
								<span style="width: 76%"></span><i style="left: 76%"></i>
							</div>
							<div class="mt-2 flex justify-between text-xs text-muted-foreground">
								<span>1:58</span><span>2:15</span>
							</div>
							<div class="mt-4 flex items-center justify-center gap-1">
								<Button variant="ghost" size="icon-sm" aria-label="back 5 seconds"
									><RotateCcwIcon /></Button
								>
								<Button size="icon-lg" aria-label="pause"><PauseIcon /></Button>
								<Button variant="ghost" size="icon-sm" aria-label="forward 5 seconds"
									><RotateCwIcon /></Button
								>
							</div>
						</div>
						<div class="match-card side-card">
							<p class="text-xs text-muted-foreground">next</p>
							<p class="mt-1 text-sm font-semibold">qualifier #19</p>
							<p class="mt-5 text-xs text-muted-foreground">up next</p>
						</div>
					</div>
					<p class="mt-5 text-center text-xs text-muted-foreground">
						drag or use arrow keys to move through matches
					</p>
				</div>
			</section>
		</div>
	</main>
</div>

<style>
	.film-stage {
		position: relative;
		background:
			linear-gradient(to right, transparent 49.8%, var(--border) 49.8% 50.2%, transparent 50.2%),
			linear-gradient(
				to bottom,
				color-mix(in oklab, var(--muted) 75%, transparent),
				var(--background)
			);
	}

	.film-stage::before {
		content: '';
		position: absolute;
		inset: 12% 8%;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--card) 30%, transparent);
	}

	.field-mark {
		position: absolute;
		z-index: 1;
		width: 11%;
		aspect-ratio: 1;
		border: 0.4rem solid color-mix(in oklab, var(--primary) 65%, transparent);
		border-radius: 18%;
		transform: rotate(45deg);
	}

	.field-mark-a {
		left: 24%;
		top: 28%;
	}
	.field-mark-b {
		right: 24%;
		top: 28%;
	}
	.field-mark-c {
		left: 44.5%;
		bottom: 18%;
	}

	.timeline {
		position: relative;
		height: 0.35rem;
		border-radius: 999px;
		background: var(--input);
	}

	.timeline span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--primary);
	}

	.timeline i {
		position: absolute;
		top: 50%;
		display: block;
		width: 0.9rem;
		height: 0.9rem;
		transform: translate(-50%, -50%);
		border: 2px solid var(--card);
		border-radius: 999px;
		background: var(--primary);
		box-shadow: 0 2px 8px color-mix(in oklab, var(--foreground) 20%, transparent);
	}

	.tape-ticks {
		background: repeating-linear-gradient(
			to right,
			transparent 0,
			transparent calc(8.333% - 1px),
			var(--border) calc(8.333% - 1px),
			var(--border) 8.333%
		);
	}

	.mode-button {
		display: inline-flex;
		height: 1.75rem;
		align-items: center;
		gap: 0.35rem;
		border-radius: var(--radius-lg);
		padding-inline: 0.65rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--muted-foreground);
		transition: 150ms ease;
	}

	.mode-button :global(svg) {
		width: 0.8rem;
		height: 0.8rem;
	}
	.mode-button.active-mode {
		background: var(--background);
		color: var(--foreground);
		box-shadow: 0 1px 3px color-mix(in oklab, var(--foreground) 12%, transparent);
	}

	.bounds {
		position: relative;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--input);
	}

	.bounds span {
		position: absolute;
		inset-block: 0;
		left: 15%;
		right: 12%;
		border-radius: inherit;
		background: var(--primary);
	}
	.bounds i,
	.bounds b {
		position: absolute;
		top: 50%;
		width: 0.8rem;
		height: 1.15rem;
		transform: translate(-50%, -50%);
		border: 2px solid var(--primary);
		border-radius: 0.25rem;
		background: var(--card);
	}
	.bounds i {
		left: 15%;
	}
	.bounds b {
		left: 88%;
	}

	.carousel-track {
		display: grid;
		grid-template-columns: minmax(10rem, 0.55fr) minmax(20rem, 1fr) minmax(10rem, 0.55fr);
		align-items: center;
		gap: 1rem;
		width: calc(100% + 6rem);
		margin-left: -3rem;
	}

	.match-card {
		border: 1px solid var(--border);
		background: var(--background);
	}
	.side-card {
		min-height: 7rem;
		border-radius: var(--radius-xl);
		padding: 1rem;
		opacity: 0.55;
	}
	.active-card {
		min-height: 13rem;
		border-radius: calc(var(--radius) * 2.2);
		padding: 1.25rem;
		box-shadow: 0 14px 35px color-mix(in oklab, var(--foreground) 10%, transparent);
	}

	@media (max-width: 640px) {
		.carousel-track {
			grid-template-columns: 8rem minmax(17rem, 1fr) 8rem;
			width: 35rem;
			margin-left: calc((100% - 35rem) / 2);
		}
		.field-mark {
			border-width: 0.25rem;
		}
	}
</style>
