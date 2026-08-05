<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import ErrorState, { describeError, errorTitle } from '$lib/components/error-state.svelte';
	import EventSidebar from './event-sidebar.svelte';

	const { children, data } = $props();
</script>

<!-- the page inside sets its own title once the event is here, so this only covers the two states
	that render in its place -->
<svelte:head>
	{#await data.eventPage}
		<title>loading event · matcha</title>
	{:then}
		<!-- the event page names itself -->
	{:catch failure}
		<title>{errorTitle(describeError(failure).status)} · matcha</title>
	{/await}
</svelte:head>

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
{:catch failure}
	<!-- this load streams, so a missing event rejects here instead of reaching the error boundary -->
	{@const described = describeError(failure)}
	<ErrorState status={described.status} message={described.message} />
{/await}
