<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { resendVerificationEmail } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	/**
	 * better-auth redirects here with `?error=<code>` when the token does not check out, and with no
	 * query at all on success. Anything we do not have wording for still has to say something.
	 */
	const FAILURES: Record<string, { title: string; detail: string; canResend: boolean }> = {
		TOKEN_EXPIRED: {
			title: 'that link expired',
			detail: 'confirmation links are only good for an hour. send yourself a fresh one.',
			canResend: true
		},
		INVALID_TOKEN: {
			title: 'that link did not work',
			detail: 'it may have been cut in half by your mail client. send yourself a fresh one.',
			canResend: true
		},
		USER_NOT_FOUND: {
			title: 'no account for that link',
			detail: 'the account it points at is gone. sign up again to start over.',
			canResend: false
		},
		INVALID_USER: {
			title: 'that link is for another account',
			detail: 'sign out of the account you are in, then open the link again.',
			canResend: false
		}
	};

	const RESEND_FAILURES: Record<string, string> = {
		EMAIL_MISMATCH: 'you are signed in as somebody else. sign out first, then ask for the link.',
		EMAIL_ALREADY_VERIFIED: 'that address is already confirmed. you can just sign in.'
	};

	const errorCode = $derived(page.url.searchParams.get('error'));
	const failure = $derived(
		errorCode
			? (FAILURES[errorCode] ?? {
					title: 'we could not confirm your email',
					detail: 'something went wrong on our end. send yourself a fresh link and try again.',
					canResend: true
				})
			: null
	);

	let email = $state('');
	let pending = $state(false);
	let sent = $state(false);
	let resendError = $state<string | null>(null);

	async function resend(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		if (pending) return;

		pending = true;
		resendError = null;

		const result = await resendVerificationEmail(email);

		pending = false;

		if (result.error) {
			// both of these only come up when you are already signed in as somebody, and better-auth's
			// own wording ("email mismatch") does not explain that
			resendError =
				RESEND_FAILURES[result.error.code ?? ''] ??
				(result.error.message ?? 'something went wrong').toLowerCase();
			return;
		}

		sent = true;
	}
</script>

<svelte:head>
	<title>{failure ? 'confirm your email' : 'email confirmed'} · matcha</title>
</svelte:head>

<div class="grid h-screen w-screen place-items-center p-6">
	<div class="flex w-full max-w-sm flex-col gap-4">
		{#if !failure}
			<div class="flex flex-col items-center gap-2 text-center">
				<div
					class="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"
				>
					<CheckIcon class="size-5" />
				</div>
				<h1 class="text-2xl font-semibold tracking-tight">email confirmed</h1>
				<p class="text-sm text-muted-foreground">
					you are signed in. go yell at your drivers about how they suck.
				</p>
			</div>
			<Button href={resolve('/(app)/events')}>browse events</Button>
		{:else}
			<div class="flex flex-col items-center gap-2 text-center">
				<div class="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
					<TriangleAlertIcon class="size-5" />
				</div>
				<h1 class="text-2xl font-semibold tracking-tight">{failure.title}</h1>
				<p class="text-sm text-muted-foreground">{failure.detail}</p>
			</div>

			{#if failure.canResend}
				{#if sent}
					<p class="text-center text-sm text-primary" role="status">
						sent. check {email.toLowerCase()} for a new link.
					</p>
				{:else}
					<form class="flex flex-col gap-4" onsubmit={resend}>
						<div class="flex flex-col gap-2">
							<Label for="verify-email">email</Label>
							<Input
								id="verify-email"
								type="email"
								bind:value={email}
								required
								autocomplete="email"
								placeholder="you@example.com"
							/>
						</div>

						{#if resendError}
							<p class="text-sm text-destructive" role="alert">{resendError}</p>
						{/if}

						<Button type="submit" disabled={pending}>
							{#if pending}<LoaderCircleIcon class="animate-spin" />{/if}
							send a new link
						</Button>
					</form>
				{/if}
			{:else}
				<Button variant="secondary" href={resolve('/')}>back to matcha</Button>
			{/if}
		{/if}
	</div>
</div>
