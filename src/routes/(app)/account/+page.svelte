<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { deleteUser, signOut } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import AuthDialog from '$lib/components/auth-dialog.svelte';
	import UserMenu from '$lib/components/user-menu.svelte';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MailCheckIcon from '@lucide/svelte/icons/mail-check';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	const user = $derived(page.data.user);
	const supportEmail = $derived(page.data.supportEmail);

	let authOpen = $state(false);
	let deleteOpen = $state(false);
	let password = $state('');
	let pending = $state(false);
	let errorMessage = $state<string | null>(null);
	let sent = $state(false);

	async function handleSignOut() {
		await signOut();
		await invalidateAll();
	}

	/**
	 * Asks better-auth to start the deletion. Nothing is removed here: it emails a confirmation
	 * link, and the account only goes when that link is opened.
	 */
	async function confirmDelete(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		if (pending) return;

		pending = true;
		errorMessage = null;

		const result = await deleteUser({ password, callbackURL: '/' });

		pending = false;
		password = '';

		if (result.error) {
			errorMessage = (result.error.message ?? 'that did not work').toLowerCase();
			return;
		}

		sent = true;
	}
</script>

<svelte:head>
	<title>your account · matcha</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto flex max-w-2xl flex-col gap-6 p-4 sm:p-6">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-lg font-semibold">your account</h1>
				<p class="text-xs text-muted-foreground">
					what matcha knows about you, and how to make it stop
				</p>
			</div>
			<UserMenu {user} />
		</div>

		{#if !user}
			<div class="flex flex-col items-start gap-2 rounded-md border border-sidebar-border p-4">
				<p class="text-sm">you are not signed in.</p>
				<Button size="sm" onclick={() => (authOpen = true)}>sign in</Button>
			</div>
		{:else}
			<div class="flex flex-col gap-3 rounded-md border border-sidebar-border p-4">
				<div class="flex flex-col gap-1">
					<span class="text-xs text-muted-foreground">display name</span>
					<span class="text-sm">{user.name.toLowerCase()}</span>
					<span class="text-xs text-muted-foreground">
						this is what chat calls you. everyone in a match can see it.
					</span>
				</div>

				<div class="flex flex-col gap-1">
					<span class="text-xs text-muted-foreground">email</span>
					<span class="text-sm">{user.email.toLowerCase()}</span>
					<span class="text-xs text-muted-foreground">
						only you and moderators can see this. it cannot be changed yet — delete this account and
						make another one if you need a different address.
					</span>
				</div>

				<div>
					<Button size="sm" variant="outline" onclick={handleSignOut}>
						<LogOutIcon class="size-3.5" />
						sign out
					</Button>
				</div>
			</div>

			<div class="flex flex-col gap-2 rounded-md border border-sidebar-border p-4">
				<h2 class="text-sm font-medium">muted or banned, and think it is wrong?</h2>
				<p class="text-xs text-muted-foreground">
					automod gets things wrong, and so do people. say what happened and a human will look at it
					again.
					{#if supportEmail}
						email <a class="underline" href="mailto:{supportEmail}">{supportEmail}</a> with your display
						name.
					{:else}
						reply to any email matcha has sent you, with your display name.
					{/if}
				</p>
			</div>

			<div class="flex flex-col gap-2 rounded-md border border-destructive/40 p-4">
				<h2 class="text-sm font-medium text-destructive">delete your account</h2>
				<p class="text-xs text-muted-foreground">
					this takes your account and everything you have posted with it, everywhere. it cannot be
					undone.
				</p>
				<div>
					<Button size="sm" variant="destructive" onclick={() => (deleteOpen = true)}>
						<TrashIcon class="size-3.5" />
						delete my account
					</Button>
				</div>
			</div>
		{/if}

		<div class="flex gap-3 text-xs text-muted-foreground">
			<a class="underline hover:text-foreground" href={resolve('/terms')}>terms</a>
			<a class="underline hover:text-foreground" href={resolve('/privacy')}>privacy</a>
		</div>
	</div>
</div>

<AuthDialog bind:open={authOpen} />

<Dialog.Root
	bind:open={deleteOpen}
	onOpenChange={(next) => {
		if (next) return;
		password = '';
		errorMessage = null;
		sent = false;
	}}
>
	<Dialog.Content class="sm:max-w-sm">
		{#if sent}
			<Dialog.Header>
				<Dialog.Title>check your email</Dialog.Title>
				<Dialog.Description>
					nothing has been deleted yet. open the link we just sent you and the account goes.
				</Dialog.Description>
			</Dialog.Header>

			<div class="flex flex-col items-center gap-3 py-2">
				<div
					class="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"
				>
					<MailCheckIcon class="size-5" />
				</div>
				<p class="text-center text-sm text-muted-foreground">
					the link is good for an hour. ignore it and you keep your account.
				</p>
			</div>

			<Button variant="secondary" onclick={() => (deleteOpen = false)}>done</Button>
		{:else}
			<Dialog.Header>
				<Dialog.Title>delete your account</Dialog.Title>
				<Dialog.Description>
					your password first, then a link by email. nothing is removed until you open it.
				</Dialog.Description>
			</Dialog.Header>

			<form class="flex flex-col gap-4" onsubmit={confirmDelete}>
				<div class="flex flex-col gap-2">
					<Label for="delete-password">password</Label>
					<Input
						id="delete-password"
						type="password"
						bind:value={password}
						required
						autocomplete="current-password"
					/>
				</div>

				{#if errorMessage}
					<p class="text-sm text-destructive" role="alert">{errorMessage}</p>
				{/if}

				<Button type="submit" variant="destructive" disabled={pending}>
					{#if pending}<LoaderCircleIcon class="animate-spin" />{/if}
					send me the link
				</Button>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
