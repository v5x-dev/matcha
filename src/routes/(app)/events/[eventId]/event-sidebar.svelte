<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { eventRoundGroups } from '$lib/match-navigation';
	import { activeClipId, activeMatchId, requestMatchRestart } from '$lib/match-param.svelte';
	import type { EventClip } from '$lib/remote/clip.remote';
	import { groupMatchesByStreamDay } from '$lib/stream-days';
	import * as InputGroup from '$lib/components/ui/input-group';
	import type { EventData, MatchData } from 'events.vex';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import Fuse from 'fuse.js';
	import { watch } from 'runed';
	import { SvelteMap } from 'svelte/reactivity';
	import { slide } from 'svelte/transition';
	import CoffeeIcon from '@lucide/svelte/icons/coffee';
	import ListIcon from '@lucide/svelte/icons/list';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import XIcon from '@lucide/svelte/icons/x';
	import EventClips from './event-clips.svelte';
	import MatchChat from './match-chat.svelte';

	let {
		event,
		matches,
		clips,
		user
	}: {
		event: EventData;
		matches: MatchData[];
		clips: EventClip[];
		user: { id: string; name: string } | null;
	} = $props();

	const eventId = $derived(Number(page.params.eventId));
	const activeMatch = $derived(activeMatchId() ?? matches[0]?.id ?? null);
	const activeMatchData = $derived(matches.find((match) => match.id === activeMatch) ?? null);

	let tab = $state('matches');
	let matchQuery = $state('');
	let clipQuery = $state('');

	function sortMatches(a: MatchData, b: MatchData): number {
		return a.instance - b.instance || a.matchnum - b.matchnum;
	}

	function matchSearchText(match: MatchData): string {
		return [
			match.name,
			match.division.name,
			match.field,
			...match.alliances.flatMap((alliance) =>
				alliance.teams.map((allianceTeam) => allianceTeam.team?.name)
			)
		]
			.filter((value): value is string => Boolean(value))
			.join(' ')
			.toLowerCase();
	}

	function matchDetails(match: MatchData): string {
		const teams = match.alliances
			.flatMap((alliance) => alliance.teams.map((allianceTeam) => allianceTeam.team?.name))
			.filter((value): value is string => Boolean(value));
		return [match.division.name, match.field, teams.join(' · ')]
			.filter((value): value is string => Boolean(value))
			.join(' · ')
			.toLowerCase();
	}

	function matchAccessibleLabel(match: MatchData): string {
		const details = matchDetails(match);
		return [match.name.toLowerCase(), details].filter(Boolean).join(' · ');
	}

	const sidebar = Sidebar.useSidebar();

	function handleMatchClick(event: MouseEvent, matchId: number) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;

		// the sidebar is a sheet on mobile, so a pick has to get it out of the way of the film
		if (sidebar.isMobile) sidebar.setOpenMobile(false);

		if (matchId !== activeMatch || activeClipId()) return;

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
	const filteredSections = $derived.by(() => {
		const query = matchQuery.trim();
		if (!query) return sections;
		const fuse = new Fuse(
			matches.map((match) => ({ id: match.id, text: matchSearchText(match) })),
			{ keys: ['text'], threshold: 0.35, ignoreLocation: true }
		);
		const ids = new Set(fuse.search(query).map((result) => result.item.id));
		return sections
			.map((section) => ({
				...section,
				matches: section.matches.filter((match) => ids.has(match.id))
			}))
			.filter((section) => section.matches.length > 0);
	});

	const groups = $derived.by(() =>
		filteredSections.flatMap((section) => {
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
		estimateSize: () => 52,
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

	// viewportRef is a dependency because the list unmounts while the chat tab is open; on the way
	// back the virtualizer starts at the top and has to be pointed at the selection again.
	$effect(() => {
		const viewport = viewportRef;
		const index = rows.findIndex((row) => row.type === 'match' && row.match.id === activeMatch);
		if (!viewport || index < 0) return;

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

	function allianceLost(match: MatchData, color: AllianceColor) {
		const alliance = allianceFor(match, color);
		const opponent = allianceFor(match, color === 'blue' ? 'red' : 'blue');
		return alliance !== undefined && opponent !== undefined && alliance.score < opponent.score;
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
	<Tabs.Root bind:value={tab} onValueChange={(value) => (tab = value)} class="min-h-0 flex-1 gap-0">
		<Sidebar.Header class="gap-1 pb-1">
			<Sidebar.MenuButton class="font-semibold tracking-tight text-primary!">
				{#snippet child({ props })}
					<a {...props} href={resolve('/')}
						><CoffeeIcon />
						<span>matcha</span></a
					>
				{/snippet}
			</Sidebar.MenuButton>
			<p class="my-1 px-2 text-sm leading-5 font-medium text-muted-foreground!">
				{event.name.split(':')[0].toLowerCase()}
			</p>
			<Tabs.List class="w-full">
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Tabs.Trigger {...props} value="matches" aria-label="matches">
								<ListIcon />
							</Tabs.Trigger>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>matches</Tooltip.Content>
				</Tooltip.Root>

				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Tabs.Trigger {...props} value="chat" aria-label="chat">
								<MessageSquareIcon />
							</Tabs.Trigger>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>match chat</Tooltip.Content>
				</Tooltip.Root>

				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Tabs.Trigger {...props} value="clips" aria-label="clips">
								<ScissorsIcon />
							</Tabs.Trigger>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>clips</Tooltip.Content>
				</Tooltip.Root>
			</Tabs.List>
			{#if tab === 'matches'}
				<div>
					<InputGroup.Root>
						<InputGroup.Addon>
							<SearchIcon />
						</InputGroup.Addon>
						<InputGroup.Input
							bind:value={matchQuery}
							placeholder="search matches or teams..."
							aria-label="search matches or teams"
							class="text-sidebar-foreground placeholder:text-muted-foreground"
						/>
						{#if matchQuery}
							<InputGroup.Addon align="inline-end">
								<InputGroup.Button
									size="icon-xs"
									aria-label="clear match search"
									onclick={() => (matchQuery = '')}
								>
									<XIcon />
								</InputGroup.Button>
							</InputGroup.Addon>
						{/if}
					</InputGroup.Root>
				</div>
			{/if}
			{#if tab === 'clips'}
				<div>
					<InputGroup.Root>
						<InputGroup.Addon>
							<SearchIcon />
						</InputGroup.Addon>
						<InputGroup.Input
							bind:value={clipQuery}
							placeholder="search clips..."
							aria-label="search clips"
							class="text-sidebar-foreground placeholder:text-muted-foreground"
						/>
						{#if clipQuery}
							<InputGroup.Addon align="inline-end">
								<InputGroup.Button
									size="icon-xs"
									aria-label="clear clip search"
									onclick={() => (clipQuery = '')}
								>
									<XIcon />
								</InputGroup.Button>
							</InputGroup.Addon>
						{/if}
					</InputGroup.Root>
				</div>
			{/if}
		</Sidebar.Header>

		<Tabs.Content value="chat" class="flex min-h-0 flex-1 flex-col">
			<MatchChat {eventId} match={activeMatchData} {user} />
		</Tabs.Content>

		<Tabs.Content value="clips" class="flex min-h-0 flex-1 flex-col">
			<EventClips {eventId} {matches} {clips} {user} query={clipQuery} />
		</Tabs.Content>

		<Tabs.Content value="matches" class="flex min-h-0 flex-1 flex-col">
			<Sidebar.Content
				bind:ref={viewportRef}
				hideScrollbar={false}
				class="matches-sidebar-scroll scrollbar-gutter-stable px-2"
				style="overflow-y: scroll;"
			>
				<div class="relative w-full shrink-0" style="height: {$virtualizer.getTotalSize()}px;">
					{#if rows.length === 0}
						<p class="px-3 py-6 text-center text-xs text-sidebar-foreground!">no matches found</p>
					{/if}
					{#if stickyHeading}
						<Sidebar.GroupLabel
							class="sticky top-0 z-20 rounded-none bg-sidebar text-muted-foreground!"
						>
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
									<Sidebar.GroupLabel
										class="{virtualRow.index === stickyHeadingIndex
											? 'invisible '
											: ''}text-muted-foreground!">{row.label}</Sidebar.GroupLabel
									>
								{:else}
									<Sidebar.MenuButton
										class="h-auto min-h-8 items-center gap-2 px-3 py-2 transition-colors duration-150 data-active:bg-sidebar-accent data-active:py-2.5"
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
														aria-label={matchAccessibleLabel(row.match)}
														onclick={(event) => handleMatchClick(event, row.match.id)}
													>
														<span class="min-w-0 truncate font-medium">
															{row.match.name.toLowerCase()}
														</span>
													</a>
													{#if row.match.id === activeMatch}
														<div class="grid gap-1" in:slide={{ duration: 180 }}>
															<span class="flex min-w-0 items-center gap-1 text-xs">
																<span class="w-5 shrink-0 font-semibold text-blue-300">
																	{allianceScore(row.match, 'blue')}
																</span>
																<span class="truncate text-sidebar-foreground!">
																	{#each allianceTeams(row.match, 'blue') as team, index (team)}
																		{#if index > 0}<span aria-hidden="true">&nbsp;·&nbsp;</span
																			>{/if}
																		<a
																			class="hover:text-foreground hover:underline"
																			class:text-muted-foreground={allianceLost(row.match, 'blue')}
																			href={teamHref(team)}>{team.toLowerCase()}</a
																		>
																	{:else}—{/each}
																</span>
															</span>
															<span class="flex min-w-0 items-center gap-1 text-xs">
																<span class="w-5 shrink-0 font-semibold text-red-300">
																	{allianceScore(row.match, 'red')}
																</span>
																<span class="truncate text-sidebar-foreground!">
																	{#each allianceTeams(row.match, 'red') as team, index (team)}
																		{#if index > 0}<span aria-hidden="true">&nbsp;·&nbsp;</span
																			>{/if}
																		<a
																			class="hover:text-foreground hover:underline"
																			class:text-muted-foreground={allianceLost(row.match, 'red')}
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
		</Tabs.Content>
	</Tabs.Root>
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
