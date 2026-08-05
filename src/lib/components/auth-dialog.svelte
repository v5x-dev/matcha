<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		requestPasswordReset,
		resendVerificationEmail,
		signIn,
		signUp,
		VERIFY_CALLBACK_URL
	} from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Tabs from '$lib/components/ui/tabs';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import MailCheckIcon from '@lucide/svelte/icons/mail-check';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let mode = $state<'sign-in' | 'sign-up'>('sign-in');
	/** the credentials form, or the one that asks for a reset link. */
	let view = $state<'credentials' | 'forgot'>('credentials');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let errorMessage = $state<string | null>(null);
	let pending = $state(false);
	/** set once a link is on its way, which replaces the form with a "check your mail" */
	let awaitingEmail = $state<string | null>(null);
	/** which link is in the post, since the two say different things about what to do next. */
	let awaiting = $state<'verification' | 'reset'>('verification');

	// a stale error from the other tab reads as if the form you are looking at failed
	function switchMode(next: string | undefined) {
		if (next !== 'sign-in' && next !== 'sign-up') return;
		mode = next;
		errorMessage = null;
	}

	function reset() {
		name = '';
		email = '';
		password = '';
		errorMessage = null;
		pending = false;
		awaitingEmail = null;
		awaiting = 'verification';
		view = 'credentials';
	}

	/**
	 * Always ends on "check your email", including for an address with no account. Anything else
	 * turns this box into a way to ask whether somebody has signed up.
	 */
	async function submitForgot(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		if (pending) return;

		pending = true;
		errorMessage = null;

		await requestPasswordReset(email);

		pending = false;
		awaiting = 'reset';
		awaitingEmail = email;
	}

	async function submit(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		if (pending) return;

		pending = true;
		errorMessage = null;

		if (mode === 'sign-up') {
			// no session comes back: better-auth holds it until the address is confirmed
			const result = await signUp.email({
				name,
				email,
				password,
				callbackURL: VERIFY_CALLBACK_URL
			});
			pending = false;

			if (result.error) {
				errorMessage = (result.error.message ?? 'something went wrong').toLowerCase();
				return;
			}

			awaitingEmail = email;
			return;
		}

		const result = await signIn.email({ email, password });

		if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
			// they already have an account, so the link they were sent at sign-up has almost certainly
			// expired by now. send another rather than making them hunt for it
			const resent = await resendVerificationEmail(email);
			pending = false;

			if (resent.error) {
				errorMessage = 'confirm your email first, but we could not send a new link. try again.';
				return;
			}

			awaitingEmail = email;
			return;
		}

		pending = false;

		if (result.error) {
			errorMessage = (result.error.message ?? 'something went wrong').toLowerCase();
			return;
		}

		// the session lives in a cookie the server load already read, so refetch it
		await invalidateAll();
		open = false;
		reset();
	}
</script>

<Dialog.Root bind:open onOpenChange={(next) => !next && reset()}>
	<Dialog.Content class="sm:max-w-sm">
		{#if awaitingEmail}
			<Dialog.Header>
				<Dialog.Title>check your email</Dialog.Title>
				<Dialog.Description>
					{#if awaiting === 'reset'}
						if {awaitingEmail.toLowerCase()} has an account, a reset link is on its way to it.
					{:else}
						we sent a confirmation link to {awaitingEmail.toLowerCase()}. open it and you are in.
					{/if}
				</Dialog.Description>
			</Dialog.Header>

			<div class="flex flex-col items-center gap-3 py-2">
				<div
					class="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"
				>
					<MailCheckIcon class="size-5" />
				</div>
				<p class="text-center text-sm text-muted-foreground">
					the link is good for an hour. check your spam folder if it does not turn up.
				</p>
			</div>

			<Button variant="secondary" onclick={() => (open = false)}>done</Button>
		{:else if view === 'forgot'}
			<Dialog.Header>
				<Dialog.Title>reset your password</Dialog.Title>
				<Dialog.Description>
					we will email you a link to set a new one. no need to remember the old one.
				</Dialog.Description>
			</Dialog.Header>

			<form class="flex flex-col gap-4" onsubmit={submitForgot}>
				<div class="flex flex-col gap-2">
					<Label for="auth-forgot-email">email</Label>
					<Input
						id="auth-forgot-email"
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

				<button
					type="button"
					class="text-xs text-muted-foreground underline hover:text-foreground"
					onclick={() => {
						view = 'credentials';
						errorMessage = null;
					}}
				>
					back to sign in
				</button>
			</form>
		{:else}
			<Dialog.Header>
				<Dialog.Title>welcome to matcha</Dialog.Title>
				<Dialog.Description>sign in to talk through the film with everyone else</Dialog.Description>
			</Dialog.Header>

			<Tabs.Root value={mode} onValueChange={switchMode}>
				<Tabs.List class="w-full">
					<Tabs.Trigger value="sign-in" class="flex-1">sign in</Tabs.Trigger>
					<Tabs.Trigger value="sign-up" class="flex-1">sign up</Tabs.Trigger>
				</Tabs.List>
			</Tabs.Root>

			<form class="flex flex-col gap-4" onsubmit={submit}>
				{#if mode === 'sign-up'}
					<div class="flex flex-col gap-2">
						<Label for="auth-name">display name</Label>
						<Input
							id="auth-name"
							bind:value={name}
							required
							maxlength={40}
							autocomplete="nickname"
							placeholder="what chat should call you"
						/>
					</div>
				{/if}

				<div class="flex flex-col gap-2">
					<Label for="auth-email">email</Label>
					<Input
						id="auth-email"
						type="email"
						bind:value={email}
						required
						autocomplete="email"
						placeholder="you@example.com"
					/>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="auth-password">password</Label>
					<Input
						id="auth-password"
						type="password"
						bind:value={password}
						required
						minlength={8}
						autocomplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
						placeholder="at least 8 characters"
					/>
				</div>

				{#if errorMessage}
					<p class="text-sm text-destructive" role="alert">{errorMessage}</p>
				{/if}

				<Button type="submit" disabled={pending}>
					{#if pending}<LoaderCircleIcon class="animate-spin" />{/if}
					{mode === 'sign-in' ? 'sign in' : 'create account'}
				</Button>

				{#if mode === 'sign-in'}
					<button
						type="button"
						class="text-xs text-muted-foreground underline hover:text-foreground"
						onclick={() => {
							view = 'forgot';
							errorMessage = null;
						}}
					>
						forgot your password?
					</button>
				{/if}
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
