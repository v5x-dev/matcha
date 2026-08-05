<script lang="ts">
	import { resolve } from '$app/paths';
	import { getTeamOverview } from '$lib/remote/team.remote';
	import { Badge } from '$lib/components/ui/badge';
	import ErrorState, { describeError } from '$lib/components/error-state.svelte';
	import {
		formatRecord,
		winRateLabel,
		type TeamEventSummary,
		type TeamMatchSummary
	} from '$lib/team-types';
	import {
		formatInteger,
		formatNumber,
		formatRange,
		shortEventName,
		signed,
		teamLocation
	} from './team-format';
	import { SvelteSet } from 'svelte/reactivity';
	import { slide } from 'svelte/transition';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import TrophyIcon from '@lucide/svelte/icons/trophy';

	const { params } = $props();
	const teamNumber = $derived(params.teamNumber.trim().toLowerCase());
	const overview = $derived(getTeamOverview(teamNumber));

	const matchHref = (match: TeamMatchSummary) =>
		resolve(`/(app)/events/[eventId]?match=${match.id}`, { eventId: match.eventId.toString() });
	const eventHref = (event: TeamEventSummary) =>
		resolve('/(app)/events/[eventId]', { eventId: event.id.toString() });

	// the most recent event is the one a scout almost always wants, so it is the only one open until
	// something is toggled.
	const toggled = new SvelteSet<number>();

	function isOpen(eventId: number, index: number): boolean {
		return toggled.has(eventId) ? index !== 0 : index === 0;
	}

	function toggle(eventId: number) {
		if (toggled.has(eventId)) toggled.delete(eventId);
		else toggled.add(eventId);
	}

	/** widest score in the season sets the bar scale, so every row is comparable at a glance. */
	function scale(matches: TeamMatchSummary[]): number {
		return Math.max(60, ...matches.map((match) => Math.max(match.score, match.opponentScore)));
	}
</script>

<svelte:head>
	<title>{teamNumber} · matcha</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	{#await overview}
		<div class="grid h-full place-items-center text-sm text-muted-foreground">loading team...</div>
	{:then data}
		{@const max = scale(data.matches)}
		<div class="mx-auto flex w-full max-w-6xl flex-col p-4 md:p-8">
			<header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1">
				<h1 class="text-3xl leading-none font-semibold tracking-tight text-primary">
					{data.team.number.toLowerCase()}
				</h1>
				<span class="text-base">{(data.team.team_name ?? 'unnamed').toLowerCase()}</span>
				<span class="text-sm text-muted-foreground">
					{(data.team.organization ?? 'unknown org').toLowerCase()} · {teamLocation(data.team)}
				</span>
			</header>

			<p class="flex flex-wrap gap-x-4 gap-y-1 pb-6 text-sm">
				<span><span class="text-muted-foreground">record</span> {formatRecord(data.record)}</span>
				<span><span class="text-muted-foreground">wr</span> {winRateLabel(data.record)}</span>
				<span>
					<span class="text-muted-foreground">avg</span>
					{formatNumber(data.stats.averageScore)}
				</span>
				<span>
					<span class="text-muted-foreground">high</span>
					{formatInteger(data.stats.highScore)}
				</span>
				<span>
					<span class="text-muted-foreground">margin</span>
					{signed(data.stats.averageMargin)}
				</span>
				<span>
					<span class="text-muted-foreground">best rank</span>
					{data.stats.bestRank === null ? '—' : `#${data.stats.bestRank}`}
				</span>
				<span>
					<span class="text-muted-foreground">skills</span>
					{formatInteger(data.skills.combined)}
					<span class="text-muted-foreground">
						({formatInteger(data.skills.driver)}/{formatInteger(data.skills.programming)})
					</span>
				</span>
				<span>
					<span class="text-muted-foreground">events</span>
					{data.stats.eventCount}
				</span>
				{#if data.awards.length > 0}
					<span class="flex items-center gap-1">
						<TrophyIcon class="size-3.5 text-primary" />
						{data.awards.length}
					</span>
				{/if}
			</p>

			<ol class="relative flex flex-col">
				<span class="absolute top-2 bottom-2 left-[7px] w-px bg-border" aria-hidden="true"></span>
				{#each data.events as event, index (event.id)}
					{@const open = isOpen(event.id, index)}
					{@const eventMatches = data.matches.filter((match) => match.eventId === event.id)}
					<li class="relative pb-6 pl-8">
						<span
							class="absolute top-1.5 left-0 size-[15px] rounded-full border-2 {event.ongoing
								? 'border-primary bg-primary'
								: 'border-border bg-background'}"
							aria-hidden="true"
						></span>

						<div class="flex items-start gap-2">
							<button
								class="-mx-1.5 -mb-1.5 shrink-0 p-1.5 text-muted-foreground"
								onclick={() => toggle(event.id)}
								aria-expanded={open}
								aria-label={open ? 'collapse matches' : 'expand matches'}
							>
								{#if open}
									<ChevronDownIcon class="size-4" />
								{:else}
									<ChevronRightIcon class="size-4" />
								{/if}
							</button>
							<div class="flex min-w-0 flex-1 flex-col gap-1">
								<span class="flex flex-wrap items-baseline gap-2">
									<a class="text-base font-medium hover:underline" href={eventHref(event)}>
										{shortEventName(event.name)}
									</a>
									{#if event.ongoing}<Badge variant="secondary">live</Badge>{/if}
									{#each event.awards as award (award)}
										<Badge variant="outline" class="gap-1">
											<TrophyIcon />
											{award.toLowerCase().replace(/\s*\(.*\)\s*$/, '')}
										</Badge>
									{/each}
								</span>
								<button
									class="text-left text-xs text-muted-foreground"
									onclick={() => toggle(event.id)}
									aria-expanded={open}
								>
									{formatRange(event.start, event.end)} · {event.rank === null
										? 'unranked'
										: `#${event.rank}`} · {formatRecord(event.record)} · {event.wp ??
										0}wp/{event.ap ?? 0}ap/{event.sp ?? 0}sp · avg {formatNumber(
										event.averagePoints
									)} · high {formatInteger(event.highScore)}
								</button>
							</div>
						</div>

						{#if open}
							<div class="mt-3 flex flex-col" transition:slide>
								{#each eventMatches as match (match.id)}
									<a
										class="flex flex-col gap-1 rounded-sm py-1.5 transition-colors hover:bg-accent lg:flex-row lg:items-center lg:gap-3 lg:py-1"
										href={matchHref(match)}
									>
										<span class="flex min-w-0 items-center gap-2 lg:contents">
											<span class="w-20 shrink-0 truncate px-1 text-xs lg:w-28"
												>{match.name.toLowerCase()}</span
											>
											<span
												class="w-1 shrink-0 self-stretch rounded-full {match.color === 'red'
													? 'bg-red-400/70'
													: 'bg-blue-400/70'}"
												aria-hidden="true"
											></span>

											<span class="flex min-w-0 flex-1 items-center gap-2">
												<span class="w-8 shrink-0 text-right text-xs font-semibold">
													{match.played ? match.score : '—'}
												</span>
												<span
													class="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
												>
													{#if match.played}
														<span
															class="absolute inset-y-0 left-0 rounded-full {match.result === 'win'
																? 'bg-primary'
																: match.result === 'loss'
																	? 'bg-destructive/70'
																	: 'bg-muted-foreground'}"
															style="width: {Math.min(100, (match.score / max) * 100)}%"
														></span>
														<span
															class="absolute inset-y-0 w-px bg-foreground/60"
															style="left: {Math.min(100, (match.opponentScore / max) * 100)}%"
														></span>
													{/if}
												</span>
												<span class="w-8 shrink-0 text-xs text-muted-foreground">
													{match.played ? match.opponentScore : '—'}
												</span>
											</span>
										</span>

										<span class="flex min-w-0 gap-3 pl-[5.5rem] lg:contents">
											<span
												class="max-w-1/2 shrink truncate text-xs text-muted-foreground lg:w-56 lg:max-w-none lg:shrink-0"
											>
												with {match.partners.map((team) => team.toLowerCase()).join(', ') || '—'}
											</span>
											<span
												class="max-w-1/2 shrink truncate text-xs text-muted-foreground lg:w-56 lg:max-w-none lg:shrink-0 lg:px-1"
											>
												vs {match.opponents.map((team) => team.toLowerCase()).join(', ') || '—'}
											</span>
										</span>
									</a>
								{:else}
									<p class="py-2 text-xs text-muted-foreground">no matches recorded</p>
								{/each}
							</div>
						{/if}
					</li>
				{:else}
					<li class="py-10 text-center text-sm text-muted-foreground">
						no events for this team this season
					</li>
				{/each}
			</ol>
		</div>
	{:catch failure}
		<!-- the overview is a remote function, so its failures land here rather than on the boundary -->
		{@const described = describeError(failure)}
		<ErrorState status={described.status} message={described.message} />
	{/await}
</div>
