<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { signIn, signUp } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Tabs from '$lib/components/ui/tabs';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let mode = $state<'sign-in' | 'sign-up'>('sign-in');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let errorMessage = $state<string | null>(null);
	let pending = $state(false);

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
	}

	async function submit(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		if (pending) return;

		pending = true;
		errorMessage = null;

		const result =
			mode === 'sign-in'
				? await signIn.email({ email, password })
				: await signUp.email({ name, email, password });

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
		</form>
	</Dialog.Content>
</Dialog.Root>
