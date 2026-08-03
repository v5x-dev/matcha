<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
</script>

<svelte:head>
	<title>matcha</title>
</svelte:head>

<div class="grid h-screen w-screen place-items-center">
	<div class="flex flex-col items-center">
		<h1 class="text-7xl font-semibold tracking-tight text-primary">matcha</h1>
		<h2 class="text-muted-foreground">freshly brewed v5rc film analysis</h2>
		<Button class="mt-2" href={resolve('/(app)/events')}>get started</Button>
	</div>
</div>
