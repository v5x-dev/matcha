<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { signOut } from '$lib/auth-client';
	import { Badge } from '$lib/components/ui/badge';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { moderationAccess } from '$lib/remote/moderation.remote';
	import { cn } from '$lib/utils.js';
	import CoffeeIcon from '@lucide/svelte/icons/coffee';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import SunIcon from '@lucide/svelte/icons/sun';
	import UserRoundIcon from '@lucide/svelte/icons/user-round';
	import { mode, toggleMode } from 'mode-watcher';

	let {
		user,
		side = 'bottom',
		align = 'end',
		class: className
	}: {
		user: { id: string; name: string; email?: string | null } | null;
		side?: 'top' | 'right' | 'bottom' | 'left';
		align?: 'start' | 'center' | 'end';
		class?: string;
	} = $props();

	const homeHref = resolve('/(app)/events');
	const accountHref = resolve('/(app)/account');
	const moderationHref = resolve('/(app)/moderation');

	// anonymous viewers get NO_ACCESS without a database read, so this is cheap either way. the
	// link only renders for people it opens for, and the count says whether it needs attention.
	const access = moderationAccess();
	const canModerate = $derived(Boolean(user) && (access.current?.canModerate ?? false));
	const waiting = $derived(access.current?.waiting ?? 0);

	const initial = $derived(user?.name.trim().slice(0, 1).toLowerCase() ?? null);

	async function handleSignOut() {
		await signOut();
		await invalidateAll();
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class={cn(
			'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm ring-1 ring-foreground/5 transition-colors hover:opacity-90 focus-visible:outline-2 dark:ring-foreground/10',
			className
		)}
		aria-label="account menu"
	>
		{#if initial}
			{initial}
		{:else}
			<UserRoundIcon class="size-4" />
		{/if}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content {side} {align} class="w-60">
		{#if user}
			<div class="flex items-center gap-3 px-2 py-2.5">
				<span
					class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary"
					aria-hidden="true"
				>
					{initial}
				</span>
				<div class="flex min-w-0 flex-col gap-0.5">
					<span class="truncate text-sm font-medium">{user.name.toLowerCase()}</span>
					{#if user.email}
						<span class="truncate text-xs text-muted-foreground">
							{user.email.toLowerCase()}
						</span>
					{/if}
				</div>
			</div>

			<DropdownMenu.Separator />
		{/if}

		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a {...props} href={homeHref}>
					<CoffeeIcon class="size-3.5" />
					events
				</a>
			{/snippet}
		</DropdownMenu.Item>

		{#if user}
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a {...props} href={accountHref}>
						<UserRoundIcon class="size-3.5" />
						account
					</a>
				{/snippet}
			</DropdownMenu.Item>

			{#if canModerate}
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a {...props} href={moderationHref}>
							<ShieldIcon class="size-3.5" />
							moderation
							{#if waiting > 0}
								<Badge variant="secondary" class="ml-auto h-5 px-1.5 text-[10px]">
									{waiting}
								</Badge>
							{/if}
						</a>
					{/snippet}
				</DropdownMenu.Item>
			{/if}
		{:else}
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a {...props} href={accountHref}>
						<UserRoundIcon class="size-3.5" />
						sign in
					</a>
				{/snippet}
			</DropdownMenu.Item>
		{/if}

		<DropdownMenu.Separator />

		<DropdownMenu.Item onSelect={() => toggleMode()}>
			{#if mode.current === 'dark'}
				<SunIcon class="size-3.5" />
				light mode
			{:else}
				<MoonIcon class="size-3.5" />
				dark mode
			{/if}
		</DropdownMenu.Item>

		{#if user}
			<DropdownMenu.Item onSelect={() => void handleSignOut()}>
				<LogOutIcon class="size-3.5" />
				sign out
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
