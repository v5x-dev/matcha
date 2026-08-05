<script lang="ts">
	import { page } from '$app/state';
	import ErrorState, { describeError, errorTitle } from '$lib/components/error-state.svelte';

	// the router already knows the status, and it is more trustworthy than anything on the error body
	const status = $derived(page.status);
	const message = $derived(describeError(page.error).message);
</script>

<svelte:head><title>{errorTitle(status)} · matcha</title></svelte:head>

<ErrorState {status} {message} />
