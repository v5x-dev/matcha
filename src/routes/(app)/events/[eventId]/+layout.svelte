<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import EventSidebar from './event-sidebar.svelte';

	const { children, data } = $props();
</script>

<Sidebar.Provider>
	<Sidebar.Inset class="max-h-screen overflow-hidden">
		{@render children()}
	</Sidebar.Inset>
	<EventSidebar event={data.event} matches={data.matches} />
</Sidebar.Provider>
