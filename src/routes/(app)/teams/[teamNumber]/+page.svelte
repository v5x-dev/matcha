<script lang="ts">
	const { params } = $props();
	const teamNumber = $derived(params.teamNumber.trim().toLowerCase());
</script>

<svelte:head>
	<title>{teamNumber} · matcha</title>
</svelte:head>

<div class="grid h-full place-items-center p-6 text-center">
	<div class="flex max-w-sm flex-col gap-2">
		<h1 class="text-xl font-semibold">team {teamNumber}</h1>
		<p class="text-sm text-muted-foreground">team details are coming soon</p>
	</div>
</div>
