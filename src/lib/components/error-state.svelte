<script lang="ts" module>
	import type { Component } from 'svelte';

	type Copy = { icon: Component; title: string; detail: string };

	/**
	 * Every `error()` we throw carries a short message meant for the person reading it, but on its own
	 * ("event not found") it does not say what to do next. Pair each status with wording that does,
	 * and keep the thrown message underneath so the specific thing that failed is still visible.
	 */
	const COPY: Record<number, Copy> = {
		400: {
			icon: TriangleAlertIcon,
			title: 'that request did not make sense',
			detail: 'something in the link or the form was off. try it again from the page you came from.'
		},
		401: {
			icon: LockIcon,
			title: 'you need to be signed in',
			detail: 'sign in from the event sidebar, then come back to this page.'
		},
		403: {
			icon: LockIcon,
			title: 'this one is not yours to open',
			detail: 'your account does not have access here.'
		},
		404: {
			icon: SearchXIcon,
			title: 'nothing lives here',
			detail: 'the event, team, or match you asked for is not around. it may have been renamed.'
		},
		429: {
			icon: ClockIcon,
			title: 'too many requests, too fast',
			detail: 'give it a moment and try again.'
		},
		502: {
			icon: UnplugIcon,
			title: 'robotevents is not answering',
			detail: 'the upstream event data is unreachable right now. this usually clears on its own.'
		},
		503: {
			icon: UnplugIcon,
			title: 'matcha is catching its breath',
			detail: 'this part of the app is temporarily unavailable. try again in a minute.'
		}
	};

	const FALLBACK: Copy = {
		icon: TriangleAlertIcon,
		title: 'something brewed wrong',
		detail: 'that is on us, not you. reloading the page fixes most of these.'
	};

	/** The headline for a status, so `<title>` can say the same thing the page does. */
	export function errorTitle(status: number): string {
		return (COPY[status] ?? FALLBACK).title;
	}

	/**
	 * A rejection can reach us as a whole `HttpError`, or — from a streamed load or a remote function
	 * — as just its body, which is why `httpError` puts the status in there too. Anything else is an
	 * unexpected failure with no status of its own.
	 */
	export function describeError(error: unknown): { status: number; message: string | null } {
		const shape = error as {
			status?: unknown;
			body?: { message?: unknown; status?: unknown };
			message?: unknown;
		};
		const carried = typeof shape?.status === 'number' ? shape.status : shape?.body?.status;
		const status = typeof carried === 'number' ? carried : 500;
		const raw =
			typeof shape?.body?.message === 'string'
				? shape.body.message
				: typeof shape?.message === 'string'
					? shape.message
					: null;

		// SvelteKit fills unexpected 500s in with "Internal Error", which tells the reader nothing our
		// own wording has not already said.
		return { status, message: raw && raw !== 'Internal Error' ? raw.toLowerCase() : null };
	}
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { Button } from '$lib/components/ui/button';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import LockIcon from '@lucide/svelte/icons/lock';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SearchXIcon from '@lucide/svelte/icons/search-x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UnplugIcon from '@lucide/svelte/icons/unplug';

	const {
		status,
		message = null
	}: {
		status: number;
		message?: string | null;
	} = $props();

	const copy = $derived(COPY[status] ?? FALLBACK);
	const Icon = $derived(copy.icon);
	// a reload is only worth offering when the failure could plausibly go away on its own; retrying a
	// 404 just lands the reader back here.
	const canRetry = $derived(status >= 500 || status === 429);
	// on a cold load straight into a bad url there is nothing behind us, and "go back" would walk the
	// reader out of matcha entirely.
	const canGoBack = $derived(browser && history.length > 1);
</script>

<div class="grid h-full w-full place-items-center p-6">
	<div class="flex w-full max-w-sm flex-col gap-6">
		<div class="flex flex-col items-center gap-3 text-center">
			<div class="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
				<Icon class="size-5" />
			</div>

			<div class="flex flex-col items-center gap-1">
				<span class="text-xs font-medium tracking-widest text-muted-foreground">{status}</span>
				<h1 class="text-2xl font-semibold tracking-tight">{copy.title}</h1>
			</div>

			<p class="text-sm text-muted-foreground">{copy.detail}</p>

			{#if message}
				<p class="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">{message}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-2">
			{#if canRetry}
				<Button onclick={() => location.reload()}>
					<RotateCcwIcon />
					try again
				</Button>
				<Button variant="ghost" href={resolve('/(app)/events')}>browse events</Button>
			{:else}
				<Button href={resolve('/(app)/events')}>browse events</Button>
				{#if canGoBack}
					<Button variant="ghost" onclick={() => history.back()}>
						<ArrowLeftIcon />
						go back
					</Button>
				{/if}
			{/if}
		</div>
	</div>
</div>
