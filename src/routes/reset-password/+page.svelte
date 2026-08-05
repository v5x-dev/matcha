<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { requestPasswordReset, resetPassword } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import MailCheckIcon from '@lucide/svelte/icons/mail-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	/**
	 * better-auth checks the token before it sends anyone here: a good one arrives as `?token=`, a
	 * spent or expired one as `?error=INVALID_TOKEN`. The form below only ever sees tokens that were
	 * live a moment ago, which is why a failure from `resetPassword` is worth spelling out.
	 */
	const token = $derived(page.url.searchParams.get('token'));
	const linkError = $derived(page.url.searchParams.get('error'));

	let password = $state('');
	let confirmation = $state('');
	let pending = $state(false);
	let done = $state(false);
	let errorMessage = $state<string | null>(null);

	let email = $state('');
	let resent = $state(false);

	async function submit(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		if (pending || !token) return;

		if (password !== confirmation) {
			errorMessage = 'those two do not match';
			return;
		}

		pending = true;
		errorMessage = null;

		const result = await resetPassword({ newPassword: password, token });

		pending = false;

		if (result.error) {
			errorMessage = (result.error.message ?? 'that did not work').toLowerCase();
			return;
		}

		done = true;
		password = '';
		confirmation = '';
	}

	async function askForAnother(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		if (pending) return;

		pending = true;
		await requestPasswordReset(email);
		pending = false;
		resent = true;
	}
</script>

<svelte:head>
	<title>reset your password · matcha</title>
</svelte:head>

<div class="grid h-screen w-screen place-items-center p-6">
	<div class="flex w-full max-w-sm flex-col gap-4">
		{#if done}
			<div class="flex flex-col items-center gap-2 text-center">
				<div
					class="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"
				>
					<CheckIcon class="size-5" />
				</div>
				<h1 class="text-2xl font-semibold tracking-tight">password changed</h1>
				<p class="text-sm text-muted-foreground">
					every other device signed in as you got signed out. sign in again with the new one.
				</p>
			</div>
			<Button onclick={() => goto(resolve('/(app)/events'))}>browse events</Button>
		{:else if token}
			<div class="flex flex-col gap-1">
				<h1 class="text-2xl font-semibold tracking-tight">choose a new password</h1>
				<p class="text-sm text-muted-foreground">
					at least 8 characters. anything already signed in as you gets signed out.
				</p>
			</div>

			<form class="flex flex-col gap-4" onsubmit={submit}>
				<div class="flex flex-col gap-2">
					<Label for="new-password">new password</Label>
					<Input
						id="new-password"
						type="password"
						bind:value={password}
						required
						minlength={8}
						autocomplete="new-password"
						placeholder="at least 8 characters"
					/>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="confirm-password">again</Label>
					<Input
						id="confirm-password"
						type="password"
						bind:value={confirmation}
						required
						minlength={8}
						autocomplete="new-password"
						placeholder="the same thing"
					/>
				</div>

				{#if errorMessage}
					<p class="text-sm text-destructive" role="alert">{errorMessage}</p>
				{/if}

				<Button type="submit" disabled={pending}>
					{#if pending}<LoaderCircleIcon class="animate-spin" />{/if}
					set new password
				</Button>
			</form>
		{:else if resent}
			<div class="flex flex-col items-center gap-2 text-center">
				<div
					class="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"
				>
					<MailCheckIcon class="size-5" />
				</div>
				<h1 class="text-2xl font-semibold tracking-tight">check your email</h1>
				<p class="text-sm text-muted-foreground">
					if {email.toLowerCase()} has an account, a fresh link is on its way to it.
				</p>
			</div>
			<Button variant="secondary" href={resolve('/(app)/events')}>back to matcha</Button>
		{:else}
			<div class="flex flex-col items-center gap-2 text-center">
				<div class="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
					<TriangleAlertIcon class="size-5" />
				</div>
				<h1 class="text-2xl font-semibold tracking-tight">
					{linkError ? 'that link expired' : 'nothing to reset'}
				</h1>
				<p class="text-sm text-muted-foreground">
					{linkError
						? 'reset links are only good for an hour, and only work once. ask for a fresh one.'
						: 'open this page from the link in your email, or ask for a new one.'}
				</p>
			</div>

			<form class="flex flex-col gap-4" onsubmit={askForAnother}>
				<div class="flex flex-col gap-2">
					<Label for="reset-email">email</Label>
					<Input
						id="reset-email"
						type="email"
						bind:value={email}
						required
						autocomplete="email"
						placeholder="you@example.com"
					/>
				</div>

				<Button type="submit" disabled={pending}>
					{#if pending}<LoaderCircleIcon class="animate-spin" />{/if}
					send me a link
				</Button>
			</form>
		{/if}
	</div>
</div>
