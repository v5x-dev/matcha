<script lang="ts">
	import AuthDialog from '$lib/components/auth-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { listMatchMessages, sendMatchMessage } from '$lib/remote/chat.remote';
	import { MAX_MESSAGE_LENGTH } from '$lib/chat';
	import { signOut } from '$lib/auth-client';
	import { invalidateAll } from '$app/navigation';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import SendIcon from '@lucide/svelte/icons/send';
	import type { MatchData } from 'events.vex';

	type ChatUser = { id: string; name: string };

	let {
		eventId,
		match,
		user
	}: { eventId: number; match: MatchData | null; user: ChatUser | null } = $props();

	/** how often chat looks for messages other people sent. */
	const POLL_INTERVAL_MS = 5000;

	const messagesQuery = $derived(match ? listMatchMessages({ eventId, matchId: match.id }) : null);
	const messages = $derived(messagesQuery?.current ?? []);
	const isLoading = $derived(
		Boolean(messagesQuery?.loading) && messagesQuery?.current === undefined
	);
	// without this a failed load falls through to `current ?? []` and renders the empty state, so a
	// chat that is merely broken claims nobody has posted
	const loadFailed = $derived(
		Boolean(messagesQuery?.error) && messagesQuery?.current === undefined
	);

	let draft = $state('');
	let errorMessage = $state<string | null>(null);
	let authOpen = $state(false);
	let viewport = $state<HTMLElement | null>(null);

	// a background tab polling every five seconds is pure waste, and the refresh on focus catches up
	$effect(() => {
		const query = messagesQuery;
		if (!query) return;

		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void query.refresh();
		}, POLL_INTERVAL_MS);

		return () => clearInterval(timer);
	});

	// jump to the newest message when the match changes or someone posts
	$effect(() => {
		void messages.length;
		void match?.id;
		if (!viewport) return;

		queueMicrotask(() => viewport?.scrollTo({ top: viewport.scrollHeight }));
	});

	// switching matches carries the half-typed message into a conversation it was not meant for
	$effect(() => {
		void match?.id;
		draft = '';
		errorMessage = null;
	});

	async function send() {
		const body = draft.trim();
		if (!body || !match || !user || sendMatchMessage.pending > 0) return;

		errorMessage = null;
		// clear straight away so the box is ready for the next line; restored if the send fails
		draft = '';

		try {
			await sendMatchMessage({ eventId, matchId: match.id, body });
		} catch {
			draft = body;
			errorMessage = 'could not send that. try again';
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void send();
	}

	function timeOf(createdAt: number) {
		return new Date(createdAt).toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	/** stable per-author tint so a wall of names is still scannable, twitch-style. */
	const authorColors = [
		'text-chart-1',
		'text-chart-2',
		'text-chart-3',
		'text-blue-400',
		'text-red-400',
		'text-primary'
	];

	function colorFor(authorId: string) {
		let hash = 0;
		for (let index = 0; index < authorId.length; index += 1) {
			hash = (hash * 31 + authorId.charCodeAt(index)) | 0;
		}

		return authorColors[Math.abs(hash) % authorColors.length];
	}

	async function handleSignOut() {
		await signOut();
		await invalidateAll();
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div
		bind:this={viewport}
		class="chat-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2"
	>
		{#if !match}
			<p class="m-auto text-center text-xs text-muted-foreground">pick a match to open its chat</p>
		{:else if isLoading}
			<p class="m-auto text-center text-xs text-muted-foreground">loading chat...</p>
		{:else if loadFailed}
			<div class="m-auto flex flex-col items-center gap-2 text-center">
				<p class="text-xs font-medium">chat could not load</p>
				<Button size="sm" variant="outline" onclick={() => void messagesQuery?.refresh()}>
					try again
				</Button>
			</div>
		{:else if messages.length === 0}
			<div class="m-auto flex flex-col items-center gap-1 text-center">
				<p class="text-xs font-medium">no one has said anything yet</p>
				<p class="text-xs text-muted-foreground">
					be the first to break down {match.name.toLowerCase()}
				</p>
			</div>
		{:else}
			{#each messages as message (message.id)}
				<p class="text-sm leading-snug break-words">
					<span
						class="mr-1 align-baseline text-[0.65rem] text-muted-foreground"
						title={new Date(message.createdAt).toLocaleString()}
					>
						{timeOf(message.createdAt)}
					</span>
					<span class="font-semibold {colorFor(message.authorId)}">
						{message.authorName.toLowerCase()}
					</span>
					<span class="text-muted-foreground">:</span>
					<span class="text-foreground">{message.body}</span>
				</p>
			{/each}
		{/if}
	</div>

	<div class="flex flex-col gap-2 border-t border-sidebar-border p-3">
		{#if !user}
			<p class="text-xs text-muted-foreground">sign in to join the conversation</p>
			<Button size="sm" onclick={() => (authOpen = true)}>sign in</Button>
		{:else}
			<Textarea
				bind:value={draft}
				rows={2}
				maxlength={MAX_MESSAGE_LENGTH}
				disabled={!match}
				placeholder="say something about this match"
				class="max-h-32 min-h-0 resize-none bg-sidebar-accent/40 text-sm"
				onkeydown={handleKeydown}
			/>

			{#if errorMessage}
				<p class="text-xs text-destructive" role="alert">{errorMessage}</p>
			{/if}

			<div class="flex items-center justify-between gap-2">
				<button
					type="button"
					class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
					onclick={handleSignOut}
				>
					<LogOutIcon class="size-3 shrink-0" />
					<span class="truncate">{user.name.toLowerCase()}</span>
				</button>

				<Button
					size="sm"
					disabled={!match || draft.trim().length === 0 || sendMatchMessage.pending > 0}
					onclick={() => void send()}
				>
					{#if sendMatchMessage.pending > 0}
						<LoaderCircleIcon class="animate-spin" />
					{:else}
						<SendIcon />
					{/if}
					chat
				</Button>
			</div>
		{/if}
	</div>
</div>

<AuthDialog bind:open={authOpen} />

<style>
	.chat-scroll {
		scrollbar-width: thin;
		scrollbar-color: var(--sidebar-border) transparent;
	}

	.chat-scroll::-webkit-scrollbar {
		width: 0.625rem;
	}

	.chat-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.chat-scroll::-webkit-scrollbar-thumb {
		border: 2px solid transparent;
		border-radius: 999px;
		background: var(--sidebar-border);
		background-clip: padding-box;
	}
</style>
