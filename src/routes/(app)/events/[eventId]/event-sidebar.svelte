<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { eventRoundGroups } from '$lib/match-navigation';
	import { activeMatchId, requestMatchRestart } from '$lib/match-param.svelte';
	import { groupMatchesByStreamDay } from '$lib/stream-days';
	import type { EventData, MatchData } from 'events.vex';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { watch } from 'runed';
	import { SvelteMap } from 'svelte/reactivity';
	import { slide } from 'svelte/transition';
	import CoffeeIcon from '@lucide/svelte/icons/coffee';

	let { event, matches }: { event: EventData; matches: MatchData[] } = $props();

	const eventId = $derived(Number(page.params.eventId));
	const activeMatch = $derived(activeMatchId() ?? matches[0]?.id ?? null);

	function sortMatches(a: MatchData, b: MatchData): number {
		return a.instance - b.instance || a.matchnum - b.matchnum;
	}

	function handleMatchClick(event: MouseEvent, matchId: number) {
		if (
			matchId !== activeMatch ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return;

		event.preventDefault();
		requestMatchRestart(matchId);
	}

	const grouping = $derived(groupMatchesByStreamDay(matches));

	// keep multi-day streams separate while leaving the round headings compact.
	const sections = $derived(
		grouping.days.length > 1
			? [
					...grouping.days.map((day) => ({
						key: day.label,
						prefix: '',
						matches: day.matches
					})),
					...(grouping.undated.length > 0
						? [{ key: 'unscheduled', prefix: 'unscheduled · ', matches: grouping.undated }]
						: [])
				]
			: [{ key: 'event', prefix: '', matches }]
	);

	// Sort each section once, then bucket matches by round. The old rendering path filtered and
	// sorted the same section once for every possible round.
	const groups = $derived.by(() =>
		sections.flatMap((section) => {
			const byRound = new SvelteMap<number, MatchData[]>();
			for (const match of [...section.matches].sort(sortMatches)) {
				const bucket = byRound.get(match.round) ?? [];
				bucket.push(match);
				byRound.set(match.round, bucket);
			}

			return eventRoundGroups.flatMap(({ round, label }) => {
				const sectionMatches = byRound.get(round);
				return sectionMatches?.length
					? [
							{
								key: `${section.key}:${label}`,
								label: `${section.prefix}${label}`,
								matches: sectionMatches
							}
						]
					: [];
			});
		})
	);

	const rows = $derived(
		groups.flatMap((group) => [
			{ type: 'heading' as const, key: `heading:${group.key}`, label: group.label },
			...group.matches.map((match) => ({ type: 'match' as const, key: `match:${match.id}`, match }))
		])
	);

	let stickyHeadingIndex = $state<number | null>(null);

	function updateStickyHeading(instance: {
		scrollOffset: number | null;
		getVirtualItemForOffset: (offset: number) => { index: number } | null | undefined;
	}) {
		if (rows.length === 0) {
			stickyHeadingIndex = null;
			return;
		}

		const currentIndex = Math.min(
			instance.getVirtualItemForOffset(instance.scrollOffset ?? 0)?.index ?? 0,
			rows.length - 1
		);
		for (let index = currentIndex; index >= 0; index -= 1) {
			if (rows[index]?.type === 'heading') {
				stickyHeadingIndex = index;
				return;
			}
		}

		stickyHeadingIndex = null;
	}

	const stickyHeading = $derived.by(() => {
		if (stickyHeadingIndex === null) return null;
		const row = rows[stickyHeadingIndex];
		return row?.type === 'heading' ? row : null;
	});

	let viewportRef = $state<HTMLElement | null>(null);
	const virtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
		count: 0,
		getScrollElement: () => viewportRef,
		estimateSize: () => 34,
		overscan: 8,
		paddingEnd: 8,
		gap: 2,
		useAnimationFrameWithResizeObserver: true,
		onChange: (instance) => updateStickyHeading(instance)
	});

	watch.pre([() => rows.length, () => viewportRef], () => {
		$virtualizer.setOptions({ count: rows.length, getScrollElement: () => viewportRef });
		updateStickyHeading($virtualizer);
	});

	$effect(() => {
		const index = rows.findIndex((row) => row.type === 'match' && row.match.id === activeMatch);
		if (index < 0) return;

		queueMicrotask(() => $virtualizer.scrollToIndex(index, { align: 'auto' }));
	});

	function measureRow(node: HTMLDivElement) {
		$virtualizer.measureElement(node);
	}

	type AllianceColor = MatchData['alliances'][number]['color'];

	function allianceFor(match: MatchData, color: AllianceColor) {
		return match.alliances.find((alliance) => alliance.color === color);
	}

	function allianceScore(match: MatchData, color: AllianceColor) {
		return allianceFor(match, color)?.score ?? 0;
	}

	function allianceTeams(match: MatchData, color: AllianceColor) {
		return (
			allianceFor(match, color)
				?.teams.map((allianceTeam) => allianceTeam.team?.name)
				.filter((name): name is string => Boolean(name)) ?? []
		);
	}

	function teamHref(teamNumber: string) {
		return resolve('/(app)/teams/[teamNumber]', { teamNumber });
	}
</script>

<Sidebar.Root variant="floating" side="right">
	<Sidebar.Header class="gap-3 pb-4">
		<Sidebar.MenuButton class="font-semibold tracking-tight text-primary!">
			{#snippet child({ props })}
				<a {...props} href={resolve('/')}
					><CoffeeIcon />
					<span>matcha</span></a
				>
			{/snippet}
		</Sidebar.MenuButton>
		<p class="px-2 text-sm leading-5 font-medium text-muted-foreground">
			{event.name.split(':')[0].toLowerCase()}
		</p>
	</Sidebar.Header>
	<Sidebar.Content
		bind:ref={viewportRef}
		hideScrollbar={false}
		class="matches-sidebar-scroll scrollbar-gutter-stable px-2"
		style="overflow-y: scroll;"
	>
		<div class="relative w-full shrink-0" style="height: {$virtualizer.getTotalSize()}px;">
			{#if stickyHeading}
				<Sidebar.GroupLabel class="sticky top-0 z-20 rounded-none bg-sidebar">
					{stickyHeading.label}
				</Sidebar.GroupLabel>
			{/if}
			{#each $virtualizer.getVirtualItems() as virtualRow (virtualRow.key)}
				{@const row = rows[virtualRow.index]}
				{#if row}
					<div
						class="absolute top-0 left-0 w-full"
						style="transform: translateY({virtualRow.start}px);"
						data-index={virtualRow.index}
						use:measureRow
					>
						{#if row.type === 'heading'}
							<Sidebar.GroupLabel class={virtualRow.index === stickyHeadingIndex ? 'invisible' : ''}
								>{row.label}</Sidebar.GroupLabel
							>
						{:else}
							<Sidebar.MenuButton
								class="h-8 items-center gap-2 px-3 py-2 transition-colors duration-150 data-active:h-auto data-active:bg-sidebar-accent data-active:py-2.5"
								isActive={row.match.id === activeMatch}
							>
								{#snippet child({ props })}
									<div {...props}>
										<div class="flex min-w-0 flex-1 flex-col gap-1">
											<a
												class="flex min-w-0 items-center gap-2"
												href={resolve(`/(app)/events/[eventId]?match=${row.match.id}`, {
													eventId: eventId.toString()
												})}
												aria-current={row.match.id === activeMatch ? 'page' : undefined}
												onclick={(event) => handleMatchClick(event, row.match.id)}
											>
												<span class="min-w-0 truncate font-medium">
													{row.match.name.toLowerCase()}
												</span>
											</a>
											{#if row.match.id === activeMatch}
												<div class="grid gap-1" in:slide={{ duration: 180 }}>
													<span class="flex min-w-0 items-center gap-1 text-xs">
														<span class="w-5 shrink-0 font-semibold text-blue-400">
															{allianceScore(row.match, 'blue')}
														</span>
														<span class="truncate text-muted-foreground">
															{#each allianceTeams(row.match, 'blue') as team, index (team)}
																{#if index > 0}<span aria-hidden="true">&nbsp;·&nbsp;</span>{/if}
																<a
																	class="hover:text-foreground hover:underline"
																	href={teamHref(team)}>{team.toLowerCase()}</a
																>
															{:else}—{/each}
														</span>
													</span>
													<span class="flex min-w-0 items-center gap-1 text-xs">
														<span class="w-5 shrink-0 font-semibold text-red-400">
															{allianceScore(row.match, 'red')}
														</span>
														<span class="truncate text-muted-foreground">
															{#each allianceTeams(row.match, 'red') as team, index (team)}
																{#if index > 0}<span aria-hidden="true">&nbsp;·&nbsp;</span>{/if}
																<a
																	class="hover:text-foreground hover:underline"
																	href={teamHref(team)}>{team.toLowerCase()}</a
																>
															{:else}—{/each}
														</span>
													</span>
												</div>
											{/if}
										</div>
									</div>
								{/snippet}
							</Sidebar.MenuButton>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</Sidebar.Content>
</Sidebar.Root>

<style>
	:global(.matches-sidebar-scroll) {
		scrollbar-width: thin;
		scrollbar-color: var(--sidebar-border) transparent;
	}

	:global(.matches-sidebar-scroll::-webkit-scrollbar) {
		display: block;
		width: 0.625rem;
	}

	:global(.matches-sidebar-scroll::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(.matches-sidebar-scroll::-webkit-scrollbar-thumb) {
		border: 2px solid transparent;
		border-radius: 999px;
		background: var(--sidebar-border);
		background-clip: padding-box;
	}
</style>
