<script lang="ts">
	import type { EventListItem, EventSearchInput, EventSearchResult } from '$lib/event-types';
	import * as Item from '$lib/components/ui/item';
	import * as InputGroup from '$lib/components/ui/input-group';
	import { resolve } from '$app/paths';
	import { searchEvents } from '$lib/remote/event.remote';
	import {
		finishBrowserMetric,
		initialPayloadBytes,
		recordBrowserMetric,
		startBrowserMetric
	} from '$lib/client/performance';
	import { Badge } from '$lib/components/ui/badge';
	import EventFiltersSheet from './event-filters-sheet.svelte';
	import { EventFilters, levels, timeframes } from './event-filters.svelte';
	import { page } from '$app/state';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	const rangeFormatter = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});

	const filters = new EventFilters();
	const validLevels = new Set(levels);
	const validTimeframes = new Set(timeframes.map((timeframe) => timeframe.value));

	function readFiltersFromUrl(search: string) {
		const params = new SvelteURLSearchParams(search);
		filters.query = params.get('q') ?? '';
		filters.levels = params
			.getAll('level')
			.filter((level): level is (typeof levels)[number] =>
				validLevels.has(level as (typeof levels)[number])
			);
		filters.regions = params.getAll('region').filter(Boolean);
		const timeframe = params.get('time');
		filters.timeframe = validTimeframes.has(timeframe as (typeof timeframes)[number]['value'])
			? (timeframe as (typeof timeframes)[number]['value'])
			: 'any';
	}

	readFiltersFromUrl(page.url.search);
	let lastUrlSearch = page.url.search;
	let urlTimer: ReturnType<typeof setTimeout> | undefined;
	let restoredScroll = false;

	function filterSearch() {
		const params = new SvelteURLSearchParams();
		if (filters.query.trim()) params.set('q', filters.query.trim());
		for (const level of filters.levels) params.append('level', level);
		for (const region of filters.regions) params.append('region', region);
		if (filters.timeframe !== 'any') params.set('time', filters.timeframe);
		const search = params.toString();
		return search ? `?${search}` : '';
	}

	// Keep the scout's query in the history entry so opening an event and pressing Back restores the
	// same results. replaceState avoids adding one browser-history entry per typed character.
	$effect(() => {
		const search = filterSearch();
		if (search === lastUrlSearch || typeof window === 'undefined') return;
		if (urlTimer) clearTimeout(urlTimer);
		urlTimer = setTimeout(() => {
			const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
			window.history.replaceState(window.history.state, '', nextUrl);
			lastUrlSearch = search;
		}, 120);
		return () => {
			if (urlTimer) clearTimeout(urlTimer);
		};
	});

	// SvelteKit updates page.url when the browser goes Back to this route. Rehydrate the local draft
	// from it so a same-route history traversal also restores the search state.
	$effect(() => {
		const search = page.url.search;
		if (search === lastUrlSearch) return;
		lastUrlSearch = search;
		readFiltersFromUrl(search);
	});
	let filtersOpen = $state(false);
	let result = $state<EventSearchResult | null>(null);
	const emptyResult: EventSearchResult = {
		events: [],
		total: 0,
		nextCursor: null,
		facets: { levels: [], regions: [] }
	};
	const currentResult = $derived(result ?? emptyResult);
	const events = $derived(currentResult.events);
	let isLoading = $state(true);
	let isLoadingMore = $state(false);
	let requestSequence = 0;
	let loadMoreSequence = 0;
	let requestTimer: ReturnType<typeof setTimeout> | undefined;
	let hasRequested = false;
	let firstUsableListMeasured = false;

	function searchInput(cursor: string | null = null): EventSearchInput {
		return {
			query: filters.query,
			levels: [...filters.levels],
			regions: [...filters.regions],
			timeframe: filters.timeframe,
			cursor,
			limit: 50
		};
	}

	$effect(() => {
		const input = searchInput();
		const sequence = ++requestSequence;
		const delay = hasRequested ? 180 : 0;
		hasRequested = true;
		if (requestTimer) clearTimeout(requestTimer);
		isLoading = true;
		viewportRef?.scrollTo({ top: 0 });
		requestTimer = setTimeout(() => {
			const metric = startBrowserMetric('event-list.search-latency', {
				queryLength: input.query.trim().length,
				filterCount:
					input.levels.length + input.regions.length + (input.timeframe === 'any' ? 0 : 1)
			});
			void searchEvents(input)
				.then((next) => {
					if (sequence !== requestSequence) return;
					result = next;
					finishBrowserMetric(metric, { resultCount: next.total });
				})
				.catch(() => {
					if (sequence === requestSequence) {
						result = { ...currentResult, events: [], total: 0, nextCursor: null };
					}
				})
				.finally(() => {
					if (sequence === requestSequence) isLoading = false;
				});
		}, delay);

		return () => {
			if (requestTimer) clearTimeout(requestTimer);
		};
	});

	async function loadMoreEvents() {
		if (isLoading || !currentResult.nextCursor || isLoadingMore) return;
		const sequence = ++requestSequence;
		const loadSequence = ++loadMoreSequence;
		isLoadingMore = true;
		try {
			const next = await searchEvents(searchInput(currentResult.nextCursor));
			if (sequence !== requestSequence) return;
			result = {
				...next,
				events: [...currentResult.events, ...next.events]
			};
		} finally {
			if (loadSequence === loadMoreSequence) isLoadingMore = false;
		}
	}

	onMount(() => {
		recordBrowserMetric('event-list.initial-payload-size', initialPayloadBytes() ?? 0, {
			initialEventCount: 0
		});
	});

	$effect(() => {
		if (firstUsableListMeasured || events.length === 0) return;
		firstUsableListMeasured = true;
		recordBrowserMetric('event-list.time-to-first-usable-list', performance.now(), {
			resultCount: currentResult.total,
			initialEventCount: events.length
		});
	});

	let viewportRef = $state<HTMLElement | null>(null);
	let loadMoreSentinel = $state<HTMLDivElement | null>(null);

	$effect(() => {
		const sentinel = loadMoreSentinel;
		const viewport = viewportRef;
		if (!sentinel || !viewport) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) void loadMoreEvents();
			},
			{ root: viewport, rootMargin: '0px 0px 320px' }
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	});

	function formatRange(start?: string, end?: string): string {
		if (!start) return 'date tbd';
		return rangeFormatter.formatRange(new Date(start), new Date(end ?? start)).toLowerCase();
	}

	function formatLocation(event: EventListItem): string {
		return [event.location.city, event.location.region]
			.filter((value): value is string => Boolean(value))
			.join(', ')
			.toLowerCase();
	}

	function saveScrollPosition() {
		if (typeof window === 'undefined' || !viewportRef) return;
		window.sessionStorage.setItem(
			`matcha.events.scroll:${window.location.search}`,
			String(viewportRef.scrollTop)
		);
	}

	$effect(() => {
		const viewport = viewportRef;
		if (restoredScroll || !viewport || events.length === 0 || typeof window === 'undefined') return;
		restoredScroll = true;
		const saved = Number(
			window.sessionStorage.getItem(`matcha.events.scroll:${window.location.search}`)
		);
		if (Number.isFinite(saved) && saved > 0)
			requestAnimationFrame(() => viewport.scrollTo({ top: saved }));
	});
</script>

<svelte:head>
	<title>events · matcha</title>
</svelte:head>

<div class="flex h-full flex-col gap-0" inert={filtersOpen}>
	<h1 class="sr-only">events</h1>
	<div class="p-2">
		<InputGroup.Root>
			<InputGroup.Addon>
				<SearchIcon />
			</InputGroup.Addon>
			<InputGroup.Input placeholder="search events..." bind:value={filters.query} />
			<InputGroup.Addon align="inline-end">
				{#if filters.query}
					<InputGroup.Button
						size="icon-xs"
						aria-label="clear search"
						onclick={() => (filters.query = '')}
					>
						<XIcon />
					</InputGroup.Button>
				{/if}
				<InputGroup.Button
					size={filters.facetCount > 0 ? 'xs' : 'icon-xs'}
					aria-label="filters"
					onclick={() => (filtersOpen = true)}
				>
					<SlidersHorizontalIcon />
					{#if filters.facetCount > 0}
						<Badge class="size-4 min-w-4 shrink-0 rounded-full p-0 text-[10px] leading-none">
							{filters.facetCount}
						</Badge>
					{/if}
				</InputGroup.Button>
			</InputGroup.Addon>
		</InputGroup.Root>
	</div>

	<div class="relative min-h-0 flex-1">
		{#if isLoading}
			<div
				class="pointer-events-none absolute inset-x-0 top-2 z-10 mx-4 flex items-center justify-center gap-2 rounded-full bg-background/85 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
				aria-live="polite"
			>
				<LoaderCircleIcon class="size-3.5 animate-spin" />
				{result ? 'searching events...' : 'loading events...'}
			</div>
		{/if}
		<div
			class="mr-2 h-full overflow-y-auto"
			bind:this={viewportRef}
			onscroll={saveScrollPosition}
			aria-busy={isLoading}
		>
			<div class="space-y-2 pr-4 pl-2">
				{#each events as event (event.id)}
					{@const location = formatLocation(event)}
					<div class="w-full" data-event-id={event.id}>
						<Item.Root variant="outline">
							<Item.Content>
								<Item.Title
									><a
										class="hover:underline"
										href={resolve('/(app)/events/[eventId]', { eventId: event.id.toString() })}
									>
										{event.name.toLowerCase()}
									</a>
								</Item.Title>
								<Item.Description class="flex min-w-0 items-center gap-2">
									<span class="shrink-0">{formatRange(event.start, event.end)}</span>
									{#if location}
										<span aria-hidden="true">·</span>
										<span class="truncate">{location}</span>
									{/if}
									{#if event.ongoing}
										<Badge variant="secondary" class="ml-auto h-5 px-1.5 text-[10px]">live</Badge>
									{/if}
								</Item.Description>
							</Item.Content>
						</Item.Root>
					</div>
				{/each}
			</div>
			{#if !isLoading && events.length === 0}
				<p class="px-2 py-6 text-center text-sm text-muted-foreground">no events found</p>
			{/if}
			{#if currentResult.nextCursor}
				<div bind:this={loadMoreSentinel} class="h-1" aria-hidden="true"></div>
				{#if isLoadingMore}
					<p class="px-2 py-2 text-center text-xs text-muted-foreground" aria-live="polite">
						loading...
					</p>
				{/if}
			{/if}
		</div>
	</div>
</div>

<EventFiltersSheet
	bind:open={filtersOpen}
	{filters}
	facets={currentResult.facets}
	total={currentResult.total}
/>
