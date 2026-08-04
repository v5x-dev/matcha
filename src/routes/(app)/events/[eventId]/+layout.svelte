<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import EventSidebar from './event-sidebar.svelte';

	const { children, data } = $props();
</script>

<Sidebar.Provider
	class="h-full min-h-0 overflow-hidden overscroll-none"
	style="--sidebar-width: 18rem;"
>
	<Sidebar.Inset class="h-full max-h-full overflow-hidden">
		{@render children()}
	</Sidebar.Inset>
	<EventSidebar event={data.event} matches={data.matches} user={data.user} />
</Sidebar.Provider>
