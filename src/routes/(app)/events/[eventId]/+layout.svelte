<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import EventSidebar from './event-sidebar.svelte';

	const { children, data } = $props();
</script>

<svelte:head><title>loading event · matcha</title></svelte:head>

{#await data.eventPage}
	<div class="grid h-full place-items-center text-sm text-muted-foreground">loading event...</div>
{:then eventPage}
	<Sidebar.Provider
		class="h-full min-h-0 touch-none overflow-hidden overscroll-none md:touch-auto"
		style="--sidebar-width: 18rem;"
	>
		<Sidebar.Inset class="h-full max-h-full overflow-hidden">
			{@render children()}
		</Sidebar.Inset>
		<EventSidebar event={eventPage.event} matches={eventPage.matches} user={data.user} />
	</Sidebar.Provider>
{:catch}
	<div class="grid h-full place-items-center text-sm text-muted-foreground">
		event could not be loaded
	</div>
{/await}
