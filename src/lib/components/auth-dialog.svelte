<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		authErrorMessage,
		captureRetryAfter,
		requestPasswordReset,
		resendVerificationEmail,
		RESEND_COOLDOWN_SECONDS,
		signIn,
		signUp,
		VERIFY_CALLBACK_URL
	} from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
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
	/** the age screen. sign-up is refused without it, on the server too. */
	let overThirteen = $state(false);
	let errorMessage = $state<string | null>(null);
	let pending = $state(false);
	/** set once a link is on its way, which replaces the form with a "check your mail" */
	let awaitingEmail = $state<string | null>(null);
	/** which link is in the post, since the two say different things about what to do next. */
	let awaiting = $state<'verification' | 'reset'>('verification');
	let resendPending = $state(false);
	let resendNotice = $state<string | null>(null);
	let resendError = $state<string | null>(null);
	/** whether a message actually went out on the way to the panel, which not every route does. */
	let sentJustNow = $state(false);
	/** seconds until another send would get past the server's per-address cooldown. */
	let cooldown = $state(0);

	// one `setTimeout` per second rather than a single interval: re-running is what reschedules it,
	// and a countdown that is torn down with the dialog cannot outlive it
	$effect(() => {
		if (cooldown <= 0) return;

		const timer = setTimeout(() => (cooldown -= 1), 1000);

		return () => clearTimeout(timer);
	});

	/**
	 * Moves to the "check your email" panel.
	 *
	 * `justSent` is whether a message went out on the way here, and it decides both what the panel
	 * claims and whether the resend button starts out counting down. Where one did, the countdown
	 * starts here rather than in the resend handler, so the first press of "send it again" waits out
	 * the same 60 seconds as every later one. Where one did not — a sign-in turned away for an
	 * unconfirmed address — starting it would be a cooldown on nothing.
	 */
	function awaitLink(kind: 'verification' | 'reset', address: string, justSent: boolean) {
		awaiting = kind;
		awaitingEmail = address;
		sentJustNow = justSent;
		resendNotice = null;
		resendError = null;
		cooldown = justSent ? RESEND_COOLDOWN_SECONDS : 0;
	}

	/**
	 * The way out of a dead end. A confirmation link goes missing for reasons the app never hears
	 * about — a typo'd address, a spam filter, a link that expired while it sat unread — and without
	 * this the only route to another one is guessing that signing in again produces one.
	 *
	 * It is also the fix for the case better-auth cannot report: signing up with an address that
	 * already has an account returns success without sending anything, on purpose, so that the form
	 * cannot be used to test which addresses are registered. That leaves "check your email" on screen
	 * with nothing on its way, and this button is what makes that recoverable.
	 */
	async function resendLink() {
		if (!awaitingEmail || resendPending || cooldown > 0) return;

		resendPending = true;
		resendNotice = null;
		resendError = null;

		let retryAfter: number | null = null;
		const fetchOptions = captureRetryAfter((seconds) => (retryAfter = seconds));

		const result =
			awaiting === 'reset'
				? await requestPasswordReset(awaitingEmail, fetchOptions)
				: await resendVerificationEmail(awaitingEmail, fetchOptions);

		resendPending = false;

		if (result.error) {
			resendError = authErrorMessage(result.error, retryAfter);
			return;
		}

		// not "sent another one": a success here only means the request was accepted. the server drops
		// sends past the per-address hourly allowance without saying so, for the same reason it will
		// not admit to the cooldown, so claiming delivery is a claim this side cannot back up
		resendNotice = 'if that address still needs a link, another one is on its way.';
		sentJustNow = true;
		cooldown = RESEND_COOLDOWN_SECONDS;
	}

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
		overThirteen = false;
		errorMessage = null;
		pending = false;
		awaitingEmail = null;
		awaiting = 'verification';
		resendPending = false;
		resendNotice = null;
		resendError = null;
		sentJustNow = false;
		cooldown = 0;
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
		awaitLink('reset', email, true);
	}

	async function submit(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		if (pending) return;

		pending = true;
		errorMessage = null;

		/** seconds to wait, if the call came back rate limited. */
		let retryAfter: number | null = null;
		const fetchOptions = captureRetryAfter((seconds) => (retryAfter = seconds));

		if (mode === 'sign-up') {
			if (!overThirteen) {
				pending = false;
				errorMessage = 'confirm you are over 13 to create an account';
				return;
			}

			// no session comes back: better-auth holds it until the address is confirmed
			const result = await signUp.email({
				name,
				email,
				password,
				overThirteen,
				callbackURL: VERIFY_CALLBACK_URL,
				fetchOptions
			});
			pending = false;

			if (result.error) {
				errorMessage = authErrorMessage(result.error, retryAfter);
				return;
			}

			awaitLink('verification', email, true);
			return;
		}

		const result = await signIn.email({ email, password, fetchOptions });
		pending = false;

		if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
			// deliberately does not send anything. this branch is reached on *every* attempt at an
			// unconfirmed account — a mistyped password, a retry, a second go an hour later — and
			// sending from here spent one of the address's four messages an hour each time, without
			// anyone asking for it. three impatient attempts and the real request, the one made by
			// the button on the panel below, is silently dropped for the rest of the hour
			awaitLink('verification', email, false);
			return;
		}

		if (result.error) {
			errorMessage = authErrorMessage(result.error, retryAfter);
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
					{:else if sentJustNow}
						we sent a confirmation link to {awaitingEmail.toLowerCase()}. open it and you are in.
					{:else}
						confirm {awaitingEmail.toLowerCase()} before you sign in. open the link we already sent,
						or ask for a fresh one.
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

			{#if resendError}
				<p class="text-center text-sm text-destructive" role="alert">{resendError}</p>
			{:else if resendNotice}
				<p class="text-center text-sm text-muted-foreground" role="status">{resendNotice}</p>
			{/if}

			<div class="flex flex-col gap-3">
				<Button variant="secondary" onclick={() => (open = false)}>done</Button>

				<button
					type="button"
					class="text-xs text-muted-foreground underline hover:text-foreground disabled:cursor-not-allowed disabled:no-underline disabled:hover:text-muted-foreground"
					disabled={resendPending || cooldown > 0}
					onclick={resendLink}
				>
					{#if resendPending}
						sending another one...
					{:else if cooldown > 0}
						you can ask for another one in {cooldown}s
					{:else}
						did not get it? send it again
					{/if}
				</button>
			</div>
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

				{#if mode === 'sign-up'}
					<div class="flex items-start gap-2.5">
						<Checkbox id="auth-over-13" bind:checked={overThirteen} class="mt-0.5" />
						<Label
							for="auth-over-13"
							class="text-sm leading-snug font-normal text-muted-foreground"
						>
							i am over 13 years old
						</Label>
					</div>
				{/if}

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
