<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import {
		clearMessageFlag,
		dismissReports,
		liftUserSanctions,
		listActiveSanctions,
		listFlaggedMessages,
		listReportedMessages,
		moderationAccess,
		removeMessage,
		sanctionChatUser,
		setChatUserRole,
		type ReportedMessage
	} from '$lib/remote/moderation.remote';
	import { toast } from 'svelte-sonner';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	const access = moderationAccess();
	const reports = listReportedMessages();
	const flagged = listFlaggedMessages();
	const sanctions = listActiveSanctions();

	/** the mute lengths a moderator actually reaches for, so nobody has to type minutes. */
	const MUTE_PRESETS = [
		{ label: '10 minutes', minutes: 10 },
		{ label: '1 hour', minutes: 60 },
		{ label: '1 day', minutes: 60 * 24 },
		{ label: '1 week', minutes: 60 * 24 * 7 }
	];

	let roleEmail = $state('');

	function reasonFrom(error: unknown, fallback: string): string {
		return (error as { body?: { message?: string } } | undefined)?.body?.message ?? fallback;
	}

	async function run(action: () => Promise<unknown>, success: string) {
		try {
			await action();
			toast.success(success);
		} catch (error) {
			toast.error(reasonFrom(error, 'that did not work'));
		}
	}

	async function mute(entry: ReportedMessage, minutes: number, label: string) {
		// the reason is shown to the person being muted, so it should say what set this off
		const reason = entry.flaggedRule
			? `moderator review of an automod flag (${entry.flaggedRule})`
			: 'moderator review of a reported message';

		await run(
			() => sanctionChatUser({ userId: entry.authorId, kind: 'mute', minutes, reason }),
			`${entry.authorName.toLowerCase()} muted for ${label}`
		);
		await sanctions.refresh();
	}

	function matchHref(entry: ReportedMessage) {
		return resolve(`/(app)/events/[eventId]?match=${entry.matchId}`, {
			eventId: entry.eventId.toString()
		});
	}

	function timeOf(value: number) {
		return new Date(value)
			.toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			})
			.toLowerCase();
	}

	async function promote(role: 'user' | 'moderator' | 'admin') {
		const email = roleEmail.trim();
		if (!email) return;

		await run(async () => {
			const target = await setChatUserRole({ email, role });
			roleEmail = '';

			return target;
		}, `${email.toLowerCase()} is now ${role}`);
	}
</script>

<svelte:head>
	<title>moderation · matcha</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	{#if access.loading}
		<p class="p-6 text-sm text-muted-foreground">checking your access...</p>
	{:else if !access.current?.canModerate}
		<div class="grid h-full place-items-center p-6 text-center">
			<div class="flex flex-col items-center gap-2">
				<ShieldIcon class="size-6 text-muted-foreground" />
				<p class="text-sm font-medium">moderation is for moderators</p>
				<p class="text-xs text-muted-foreground">ask an admin if you should have access</p>
			</div>
		</div>
	{:else}
		<div class="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
			<div>
				<h1 class="text-lg font-semibold">chat moderation</h1>
				<p class="text-xs text-muted-foreground">
					reports, automod flags, and everyone currently muted or banned
				</p>
			</div>

			<Tabs.Root value="reports">
				<Tabs.List>
					<Tabs.Trigger value="reports">
						reports
						{#if (reports.current?.length ?? 0) > 0}
							<Badge variant="secondary" class="ml-1">{reports.current?.length}</Badge>
						{/if}
					</Tabs.Trigger>
					<Tabs.Trigger value="flagged">
						automod flags
						{#if (flagged.current?.length ?? 0) > 0}
							<Badge variant="secondary" class="ml-1">{flagged.current?.length}</Badge>
						{/if}
					</Tabs.Trigger>
					<Tabs.Trigger value="sanctions">mutes and bans</Tabs.Trigger>
					{#if access.current?.isAdmin}
						<Tabs.Trigger value="roles">roles</Tabs.Trigger>
					{/if}
				</Tabs.List>

				<Tabs.Content value="reports" class="flex flex-col gap-2 pt-3">
					{#if reports.loading && reports.current === undefined}
						<p class="text-sm text-muted-foreground">loading reports...</p>
					{:else if (reports.current?.length ?? 0) === 0}
						<p class="text-sm text-muted-foreground">nothing reported. quiet day</p>
					{:else}
						{#each reports.current ?? [] as entry (entry.messageId)}
							{@render queueRow(entry, true)}
						{/each}
					{/if}
				</Tabs.Content>

				<Tabs.Content value="flagged" class="flex flex-col gap-2 pt-3">
					{#if flagged.loading && flagged.current === undefined}
						<p class="text-sm text-muted-foreground">loading flags...</p>
					{:else if (flagged.current?.length ?? 0) === 0}
						<p class="text-sm text-muted-foreground">automod has nothing waiting on you</p>
					{:else}
						{#each flagged.current ?? [] as entry (entry.messageId)}
							{@render queueRow(entry, false)}
						{/each}
					{/if}
				</Tabs.Content>

				<Tabs.Content value="sanctions" class="flex flex-col gap-2 pt-3">
					{#if sanctions.loading && sanctions.current === undefined}
						<p class="text-sm text-muted-foreground">loading...</p>
					{:else if (sanctions.current?.length ?? 0) === 0}
						<p class="text-sm text-muted-foreground">nobody is muted or banned right now</p>
					{:else}
						{#each sanctions.current ?? [] as entry (entry.userId + entry.createdAt)}
							<div
								class="flex flex-wrap items-center gap-2 rounded-md border border-sidebar-border p-3"
							>
								<Badge variant={entry.kind === 'ban' ? 'destructive' : 'secondary'}>
									{entry.kind}
								</Badge>
								<span class="text-sm font-medium">{entry.userName.toLowerCase()}</span>
								<span class="text-xs text-muted-foreground">{entry.reason}</span>
								{#if entry.automated}
									<Badge variant="outline">automod</Badge>
								{/if}
								<span class="ml-auto text-xs text-muted-foreground">
									{entry.expiresAt === null ? 'no end date' : `until ${timeOf(entry.expiresAt)}`}
								</span>
								<Button
									size="sm"
									variant="outline"
									onclick={() =>
										void run(async () => {
											await liftUserSanctions({ userId: entry.userId });
										}, `${entry.userName.toLowerCase()} can chat again`)}
								>
									lift
								</Button>
							</div>
						{/each}
					{/if}
				</Tabs.Content>

				{#if access.current?.isAdmin}
					<Tabs.Content value="roles" class="flex flex-col gap-3 pt-3">
						<p class="text-xs text-muted-foreground">
							moderators can delete messages, mute for a fixed time, and work the queue. admins can
							also ban with no end date and change roles.
						</p>
						<div class="flex flex-wrap items-center gap-2">
							<Input
								bind:value={roleEmail}
								placeholder="email address"
								type="email"
								class="max-w-xs"
							/>
							<Button size="sm" onclick={() => void promote('moderator')}>make moderator</Button>
							<Button size="sm" variant="outline" onclick={() => void promote('admin')}>
								make admin
							</Button>
							<Button size="sm" variant="ghost" onclick={() => void promote('user')}>
								remove access
							</Button>
						</div>
					</Tabs.Content>
				{/if}
			</Tabs.Root>
		</div>
	{/if}
</div>

{#snippet queueRow(entry: ReportedMessage, fromReports: boolean)}
	<div class="flex flex-col gap-2 rounded-md border border-sidebar-border p-3">
		<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
			<span class="font-medium text-foreground">{entry.authorName.toLowerCase()}</span>
			<span>{timeOf(entry.createdAt)}</span>
			{#if fromReports}
				<Badge variant="secondary">{entry.reports} report{entry.reports === 1 ? '' : 's'}</Badge>
			{/if}
			{#if entry.reasons}
				<span>{entry.reasons.split(',').join(', ')}</span>
			{/if}
			{#if entry.deleted}
				<Badge variant="outline">already deleted</Badge>
			{/if}
			<a class="ml-auto underline hover:text-foreground" href={matchHref(entry)}>open the match</a>
		</div>

		<p class="text-sm break-words">{entry.body}</p>

		<div class="flex flex-wrap items-center gap-2">
			{#if !entry.deleted}
				<Button
					size="sm"
					variant="destructive"
					onclick={() =>
						void run(async () => {
							await removeMessage({ messageId: entry.messageId });
						}, 'message removed')}
				>
					<TrashIcon class="size-3.5" />
					delete
				</Button>
			{/if}

			{#if fromReports}
				<Button
					size="sm"
					variant="outline"
					onclick={() =>
						void run(async () => {
							await dismissReports({ messageId: entry.messageId });
						}, 'reports dismissed')}
				>
					<CheckIcon class="size-3.5" />
					looks fine
				</Button>
			{:else}
				<Button
					size="sm"
					variant="outline"
					onclick={() =>
						void run(async () => {
							await clearMessageFlag({ messageId: entry.messageId });
						}, 'flag cleared')}
				>
					<CheckIcon class="size-3.5" />
					looks fine
				</Button>
			{/if}

			<span class="ml-auto flex flex-wrap items-center gap-1">
				<span class="text-xs text-muted-foreground">mute for</span>
				{#each MUTE_PRESETS as preset (preset.minutes)}
					<Button
						size="sm"
						variant="ghost"
						onclick={() => void mute(entry, preset.minutes, preset.label)}
					>
						{preset.label}
					</Button>
				{/each}
			</span>
		</div>
	</div>
{/snippet}
