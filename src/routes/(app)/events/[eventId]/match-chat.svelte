<script lang="ts">
	import AuthDialog from '$lib/components/auth-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		blockChatUser,
		chatViewerState,
		deleteMatchMessage,
		listBlockedChatUsers,
		listMatchMessages,
		reportMatchMessage,
		sendMatchMessage,
		unblockChatUser,
		type MatchMessage
	} from '$lib/remote/chat.remote';
	import { MAX_MESSAGE_LENGTH } from '$lib/chat';
	import { signOut } from '$lib/auth-client';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import SendIcon from '@lucide/svelte/icons/send';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import UserXIcon from '@lucide/svelte/icons/user-x';
	import { toast } from 'svelte-sonner';
	import type { MatchData } from 'events.vex';

	type ChatUser = { id: string; name: string };

	const REPORT_REASONS = [
		{ value: 'harassment', label: 'harassment' },
		{ value: 'hate', label: 'hate speech' },
		{ value: 'spam', label: 'spam' },
		{ value: 'sexual', label: 'sexual content' },
		{ value: 'other', label: 'something else' }
	] as const;

	let {
		eventId,
		match,
		user
	}: { eventId: number; match: MatchData | null; user: ChatUser | null } = $props();

	/** how often chat looks for messages other people sent. */
	const POLL_INTERVAL_MS = 5000;

	const messagesQuery = $derived(match ? listMatchMessages({ eventId, matchId: match.id }) : null);
	const messages = $derived(messagesQuery?.current ?? []);

	const viewerQuery = chatViewerState();
	const viewer = $derived(viewerQuery.current);
	const canModerate = $derived(viewer?.canModerate ?? false);
	const sanction = $derived(viewer?.sanction ?? null);
	const blockCount = $derived(viewer?.blockedIds.length ?? 0);
	const waiting = $derived(viewer?.queued ?? 0);
	const blockedUsers = listBlockedChatUsers();
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
	/** the message the report dialog is about, and the thing that opens the dialog. */
	let reportTarget = $state<MatchMessage | null>(null);
	let blocksOpen = $state(false);

	// a background tab polling every five seconds is pure waste, and the refresh on focus catches up
	$effect(() => {
		const query = messagesQuery;
		if (!query) return;

		const timer = setInterval(() => {
			if (document.visibilityState !== 'visible') return;

			void query.refresh();
			// a mute that has run out should give the composer back without a reload, and a moderator
			// should see the queue fill up while they are watching the match it happened in
			if (sanction || canModerate) void viewerQuery.refresh();
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

	/**
	 * Remote functions send `error()` bodies through as `{ message, status }`, and for chat the
	 * message is the whole point: "keep chat clean" and "slow down for a minute" are what tell
	 * someone how to fix their message, so a generic failure string would be a downgrade.
	 */
	function reasonFrom(error: unknown, fallback: string): string {
		const body = (error as { body?: { message?: string } } | undefined)?.body;

		return body?.message ?? fallback;
	}

	async function send() {
		const body = draft.trim();
		if (!body || !match || !user || sendMatchMessage.pending > 0) return;

		errorMessage = null;
		// clear straight away so the box is ready for the next line; restored if the send fails
		draft = '';

		try {
			await sendMatchMessage({ eventId, matchId: match.id, body });
		} catch (error) {
			draft = body;
			errorMessage = reasonFrom(error, 'could not send that. try again');
			// automod and rate limits both change what the sender is allowed to do next
			void viewerQuery.refresh();
		}
	}

	async function remove(messageId: string) {
		try {
			await deleteMatchMessage({ messageId });
		} catch (error) {
			toast.error(reasonFrom(error, 'could not delete that message'));
		}
	}

	async function report(messageId: string, reason: (typeof REPORT_REASONS)[number]['value']) {
		reportTarget = null;

		try {
			await reportMatchMessage({ messageId, reason });
			toast.success('reported. a moderator will take a look');
		} catch (error) {
			toast.error(reasonFrom(error, 'could not report that message'));
		}
	}

	async function unblock(userId: string, name: string) {
		try {
			await unblockChatUser({ userId });
			await Promise.all([blockedUsers.refresh(), messagesQuery?.refresh()]);
			toast.success(`you can see ${name.toLowerCase()} again`);
		} catch (error) {
			toast.error(reasonFrom(error, 'could not unblock that person'));
		}
	}

	async function block(authorId: string, authorName: string) {
		try {
			await blockChatUser({ userId: authorId });
			// the block only takes effect on the next read of the list
			await messagesQuery?.refresh();
			toast.success(`you will not see messages from ${authorName.toLowerCase()}`);
		} catch (error) {
			toast.error(reasonFrom(error, 'could not block that person'));
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void send();
	}

	/** "until 4:05 pm" reads better than a countdown that needs its own ticking timer. */
	function describeSanctionEnd(expiresAt: number | null) {
		if (expiresAt === null) return 'indefinitely';

		const end = new Date(expiresAt);
		const sameDay = end.toDateString() === new Date().toDateString();

		return `until ${
			sameDay
				? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
				: end.toLocaleString(undefined, {
						month: 'short',
						day: 'numeric',
						hour: 'numeric',
						minute: '2-digit'
					})
		}`.toLowerCase();
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
				{@const own = message.authorId === user?.id}
				<div class="group flex items-start gap-1">
					<p class="min-w-0 flex-1 text-sm leading-snug break-words">
						<span
							class="mr-1 align-baseline text-[0.65rem] text-muted-foreground"
							title={new Date(message.createdAt).toLocaleString()}
						>
							{timeOf(message.createdAt)}
						</span>
						{#if message.authorRole !== 'user'}
							<ShieldIcon
								class="mr-0.5 inline size-3 align-[-0.1em] text-primary"
								aria-label="moderator"
							/>
						{/if}
						<span class="font-semibold {colorFor(message.authorId)}">
							{message.authorName.toLowerCase()}
						</span>
						<span class="text-muted-foreground">:</span>
						<span class="text-foreground">{message.body}</span>
						{#if message.flaggedRule}
							<span
								class="ml-1 rounded bg-sidebar-accent px-1 text-[0.65rem] text-muted-foreground"
								title="automod flagged this for review"
							>
								{message.flaggedRule}
							</span>
						{/if}
					</p>

					{#if user}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
								aria-label="message actions"
							>
								<EllipsisIcon class="size-3.5" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-44">
								{#if own || canModerate}
									<DropdownMenu.Item onSelect={() => void remove(message.id)}>
										<TrashIcon class="size-3.5" />
										delete message
									</DropdownMenu.Item>
								{/if}

								{#if !own}
									<DropdownMenu.Item onSelect={() => (reportTarget = message)}>
										<FlagIcon class="size-3.5" />
										report
									</DropdownMenu.Item>

									<DropdownMenu.Item
										onSelect={() => void block(message.authorId, message.authorName)}
									>
										<UserXIcon class="size-3.5" />
										block this person
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<div class="flex flex-col gap-2 border-t border-sidebar-border p-3">
		{#if !user}
			<p class="text-xs text-muted-foreground">sign in to join the conversation</p>
			<Button size="sm" onclick={() => (authOpen = true)}>sign in</Button>
		{:else if sanction}
			<div class="rounded-md border border-destructive/40 bg-destructive/10 p-2">
				<p class="text-xs font-medium text-destructive">
					{sanction.kind === 'ban' ? 'you are banned from chat' : 'you are muted'}
					{describeSanctionEnd(sanction.expiresAt)}
				</p>
				<p class="mt-0.5 text-xs text-muted-foreground">{sanction.reason}</p>
				<a
					class="mt-1 inline-block text-xs text-muted-foreground underline hover:text-foreground"
					href={resolve('/(app)/account')}
				>
					think this is wrong? appeal it
				</a>
			</div>
			<button
				type="button"
				class="flex min-w-0 items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
				onclick={handleSignOut}
			>
				<LogOutIcon class="size-3 shrink-0" />
				<span class="truncate">{user.name.toLowerCase()}</span>
			</button>
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
				<div class="flex min-w-0 items-center gap-2">
					<button
						type="button"
						class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						onclick={handleSignOut}
					>
						<LogOutIcon class="size-3 shrink-0" />
						<span class="truncate">{user.name.toLowerCase()}</span>
					</button>

					<a
						class="shrink-0 text-xs text-muted-foreground hover:text-foreground"
						href={resolve('/(app)/account')}
					>
						account
					</a>

					{#if blockCount > 0}
						<button
							type="button"
							class="shrink-0 text-xs text-muted-foreground hover:text-foreground"
							onclick={() => (blocksOpen = true)}
						>
							blocked ({blockCount})
						</button>
					{/if}

					{#if canModerate}
						<a
							class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
							href={resolve('/(app)/moderation')}
						>
							<ShieldIcon class="size-3" />
							mod
							{#if waiting > 0}
								<!-- the queue is the one thing here nobody gets told about, so it has to be
								     visible from the chat a moderator is already sitting in -->
								<span
									class="rounded-full bg-primary px-1.5 text-[0.65rem] font-semibold text-primary-foreground"
								>
									{waiting > 99 ? '99+' : waiting}
								</span>
							{/if}
						</a>
					{/if}
				</div>

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

<Dialog.Root
	open={reportTarget !== null}
	onOpenChange={(open) => {
		if (!open) reportTarget = null;
	}}
>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>report this message</Dialog.Title>
			<Dialog.Description>
				what is wrong with it? a moderator sees the message and who sent it.
			</Dialog.Description>
		</Dialog.Header>

		{#if reportTarget}
			<p class="rounded-md bg-sidebar-accent/40 p-2 text-sm break-words">
				<span class="font-semibold">{reportTarget.authorName.toLowerCase()}</span>
				<span class="text-muted-foreground">:</span>
				{reportTarget.body}
			</p>

			<div class="flex flex-col gap-1">
				{#each REPORT_REASONS as reason (reason.value)}
					{@const target = reportTarget}
					<Button
						variant="outline"
						size="sm"
						class="justify-start"
						onclick={() => void report(target.id, reason.value)}
					>
						{reason.label}
					</Button>
				{/each}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={blocksOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>blocked people</Dialog.Title>
			<Dialog.Description>you do not see anything these people post.</Dialog.Description>
		</Dialog.Header>

		{#if (blockedUsers.current?.length ?? 0) === 0}
			<p class="text-sm text-muted-foreground">you have not blocked anyone</p>
		{:else}
			<div class="flex flex-col gap-1">
				{#each blockedUsers.current ?? [] as blocked (blocked.id)}
					<div class="flex items-center justify-between gap-2">
						<span class="truncate text-sm">{blocked.name.toLowerCase()}</span>
						<Button
							size="sm"
							variant="outline"
							onclick={() => void unblock(blocked.id, blocked.name)}
						>
							unblock
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

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
