<script lang="ts">
	import { getTeam } from '$lib/remote/team.remote';

	const { params } = $props();
	const team = $derived(await getTeam(params.teamNumber));
</script>

<svelte:head>
	<title>{team.number.toLowerCase()} · matcha</title>
</svelte:head>
