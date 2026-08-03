<script lang="ts">
	import type { EventListItem, EventSearchInput, EventSearchResult } from '$lib/event-types';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
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
	import { EventFilters } from './event-filters.svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import { watch } from 'runed';
	import { onMount } from 'svelte';

	const rangeFormatter = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});

	let { data } = $props();

	const filters = new EventFilters();
	let filtersOpen = $state(false);
	let result = $state<EventSearchResult | null>(null);
	const currentResult = $derived(result ?? data.eventSearch);
	const events = $derived(currentResult.events);
	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let requestSequence = 0;
	let loadMoreSequence = 0;
	let resultRevision = $state(0);
	let requestTimer: ReturnType<typeof setTimeout> | undefined;
	let skipInitialRequest = true;
	let firstUsableListMeasured = false;

	function waitForLayout() {
		return new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

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
		if (skipInitialRequest) {
			skipInitialRequest = false;
			return;
		}

		const sequence = ++requestSequence;
		if (requestTimer) clearTimeout(requestTimer);
		isLoading = true;
		requestTimer = setTimeout(() => {
			const metric = startBrowserMetric('event-list.search-latency', {
				queryLength: input.query.trim().length,
				filterCount:
					input.levels.length + input.regions.length + (input.timeframe === 'any' ? 0 : 1)
			});
			void searchEvents(input)
				.then((next) => {
					if (sequence !== requestSequence) return;
					resultRevision += 1;
					result = next;
					finishBrowserMetric(metric, { resultCount: next.total });
				})
				.catch(() => {
					if (sequence === requestSequence) {
						resultRevision += 1;
						result = { ...currentResult, events: [], total: 0, nextCursor: null };
					}
				})
				.finally(() => {
					if (sequence !== requestSequence) return;
					void waitForLayout().then(() => {
						if (sequence === requestSequence) isLoading = false;
					});
				});
		}, 180);

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
			initialEventCount: currentResult.events.length
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

	const virtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
		count: 0,
		getScrollElement: () => viewportRef,
		getItemKey: (index) => events[index]?.id ?? index,
		estimateSize: () => 78,
		overscan: 4,
		paddingEnd: 8,
		measureElement: (element, entry) => {
			const box = entry?.borderBoxSize?.[0];
			return box ? box.blockSize : element.getBoundingClientRect().height;
		},
		// defer row measurements so dynamic heights do not update the layout from
		// inside the ResizeObserver callback and trigger a browser loop error.
		useAnimationFrameWithResizeObserver: true
	});

	// pre so the row count shrinks before the list re-renders, otherwise virtual rows
	// briefly point past the end of a freshly filtered list.
	watch.pre([() => events.length, () => viewportRef], () => {
		$virtualizer.setOptions({
			count: events.length,
			getScrollElement: () => viewportRef
		});
	});

	watch(
		() => [filters.query, filters.levels, filters.regions, filters.timeframe, events.length],
		() => {
			$virtualizer.measure();
			viewportRef?.scrollTo({ top: 0 });
		}
	);

	function measureRow(node: HTMLDivElement) {
		$virtualizer.measureElement(node);
	}

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
</script>

<svelte:head>
	<title>events · matcha</title>
</svelte:head>

<div class="flex h-full flex-col gap-0">
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
		{#if isLoading}
			<p class="px-1 pt-1 text-xs text-muted-foreground" aria-live="polite">searching events...</p>
		{/if}
	</div>

	<div
		class={['mr-2 min-h-0 flex-1 overflow-y-auto', isLoading && 'invisible']}
		bind:this={viewportRef}
	>
		<div class="relative w-full" style="height: {$virtualizer.getTotalSize()}px;">
			{#each $virtualizer.getVirtualItems() as row (`${events[row.index]?.id ?? row.key}:${resultRevision}`)}
				{@const event = events[row.index]}
				{#if event}
					{@const location = formatLocation(event)}
					<div
						class={[
							'absolute top-0 left-0 w-full pr-4 pl-2',
							row.index < events.length - 1 && 'pb-2'
						]}
						style="transform: translateY({row.start}px);"
						data-index={row.index}
						use:measureRow
					>
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
				{/if}
			{/each}
		</div>
		{#if events.length === 0}
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

<EventFiltersSheet
	bind:open={filtersOpen}
	{filters}
	facets={currentResult.facets}
	total={currentResult.total}
/>
