<script lang="ts">
	import type { EventLevel } from 'events.vex';
	import { searchEvents } from '$lib/remote/event.remote';
	import type { EventFacet, EventSearchResult } from '$lib/event-types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import { EventFilters, timeframes, type Timeframe } from './event-filters.svelte';

	let {
		open = $bindable(false),
		filters,
		facets,
		total
	}: {
		open?: boolean;
		filters: EventFilters;
		facets: EventSearchResult['facets'];
		total: number;
	} = $props();

	// changes are staged in a draft: nothing hits the list until "show results".
	const draft = new EventFilters();

	let draftResult = $state<EventSearchResult | null>(null);
	let regionQuery = $state('');
	const levels = $derived(facets.levels as EventFacet[]);
	const regions = $derived(facets.regions as EventFacet[]);
	const filteredRegions = $derived.by(() => {
		const query = regionQuery.trim().toLowerCase();
		return query ? regions.filter((region) => region.value.toLowerCase().includes(query)) : regions;
	});
	let requestSequence = 0;
	let requestTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!open) return;
		const input = {
			query: draft.query,
			levels: [...draft.levels],
			regions: [...draft.regions],
			timeframe: draft.timeframe,
			limit: 1
		};
		const sequence = ++requestSequence;
		if (requestTimer) clearTimeout(requestTimer);
		requestTimer = setTimeout(() => {
			void searchEvents(input).then((result) => {
				if (sequence === requestSequence) draftResult = result;
			});
		}, 120);

		return () => {
			if (requestTimer) clearTimeout(requestTimer);
		};
	});

	$effect(() => {
		if (!open) return;
		draft.query = filters.query;
		draft.levels = [...filters.levels];
		draft.regions = [...filters.regions];
		draft.timeframe = filters.timeframe;
		regionQuery = '';
	});

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			open = false;
		}
	}

	function apply() {
		filters.levels = [...draft.levels];
		filters.regions = [...draft.regions];
		filters.timeframe = draft.timeframe;
		open = false;
	}

	const rowClass =
		'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent';
	const checkboxClass =
		'flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-border bg-input/90 text-primary-foreground transition-colors';
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="fixed inset-0 z-50"
	class:pointer-events-auto={open}
	class:pointer-events-none={!open}
	aria-hidden={!open}
	inert={!open}
>
	<button
		type="button"
		class="absolute inset-0 h-full w-full cursor-default bg-black/30 transition-opacity duration-200 ease-out"
		class:opacity-100={open}
		class:opacity-0={!open}
		aria-hidden="true"
		tabindex="-1"
		onclick={() => (open = false)}
	></button>

	<dialog
		open
		class="fixed inset-y-0 right-0 left-auto z-10 m-0 flex h-full w-[min(24rem,calc(100vw-1rem))] max-w-sm flex-col border-l border-border bg-popover text-sm text-popover-foreground shadow-xl transition-transform duration-200 ease-out"
		class:translate-x-0={open}
		class:translate-x-full={!open}
		aria-labelledby="filters-title"
		aria-modal="true"
	>
		<div class="relative flex flex-col gap-1.5 p-4 sm:p-6">
			<h2 id="filters-title" class="font-heading text-base font-medium text-foreground">filters</h2>
			<p class="text-sm text-muted-foreground">narrow the event list, then apply</p>
			<Button
				variant="ghost"
				class="absolute top-4 right-4 bg-secondary"
				size="icon-sm"
				aria-label="close filters"
				onclick={() => (open = false)}
			>
				<XIcon />
			</Button>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="flex flex-col gap-5 px-4 pb-4">
				<div class="flex flex-col gap-2">
					<span class="text-xs text-muted-foreground">when</span>
					<div class="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap" role="group" aria-label="when">
						{#each timeframes as timeframe (timeframe.value)}
							<button
								type="button"
								class={`inline-flex h-8 items-center justify-center rounded-md border border-border px-2 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${draft.timeframe === timeframe.value ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
								aria-pressed={draft.timeframe === timeframe.value}
								onclick={() => (draft.timeframe = timeframe.value as Timeframe)}
							>
								{timeframe.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="h-px w-full bg-border"></div>

				<div class="flex flex-col gap-1">
					<span class="text-xs text-muted-foreground">level</span>
					{#each levels as level (level.value)}
						<button
							type="button"
							class={rowClass}
							aria-pressed={draft.levels.includes(level.value as EventLevel)}
							onclick={() => draft.toggleLevel(level.value as EventLevel)}
						>
							<span
								class={`${checkboxClass} ${draft.levels.includes(level.value as EventLevel) ? 'border-primary bg-primary' : ''}`}
								aria-hidden="true"
							>
								{#if draft.levels.includes(level.value as EventLevel)}
									<CheckIcon class="size-3.5" />
								{/if}
							</span>
							<span class="flex-1 text-left">{level.value.toLowerCase()}</span>
							<span class="text-xs text-muted-foreground">{level.count}</span>
						</button>
					{/each}
				</div>

				<div class="h-px w-full bg-border"></div>

				<div class="flex flex-col gap-1">
					<span class="text-xs text-muted-foreground">region</span>
					<Input
						bind:value={regionQuery}
						placeholder="search regions..."
						aria-label="search regions"
						class="mb-1"
					/>
					{#each filteredRegions as region (region.value)}
						<button
							type="button"
							class={rowClass}
							aria-pressed={draft.regions.includes(region.value)}
							onclick={() => draft.toggleRegion(region.value)}
						>
							<span
								class={`${checkboxClass} ${draft.regions.includes(region.value) ? 'border-primary bg-primary' : ''}`}
								aria-hidden="true"
							>
								{#if draft.regions.includes(region.value)}
									<CheckIcon class="size-3.5" />
								{/if}
							</span>
							<span class="flex-1 truncate text-left">{region.value.toLowerCase()}</span>
							<span class="text-xs text-muted-foreground">{region.count}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="mt-auto flex flex-row items-center gap-2 border-t border-border p-4 sm:p-6">
			<Button
				variant="ghost"
				onclick={() => {
					draft.reset();
					regionQuery = '';
				}}
			>
				reset
			</Button>
			<Button class="flex-1" onclick={apply}>show {draftResult?.total ?? total} events</Button>
		</div>
	</dialog>
</div>
