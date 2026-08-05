<script lang="ts">
	/**
	 * Draft privacy policy. Every list below is meant to match `src/lib/server/db/schema.ts` — if a
	 * column is added that holds something about a person, it belongs here too.
	 *
	 * This has not been through a lawyer. It is a starting point for one, not a substitute.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const supportEmail = $derived(page.data.supportEmail);
	const updated = 'august 2026';
</script>

<svelte:head>
	<title>privacy · matcha</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<article class="mx-auto flex max-w-2xl flex-col gap-6 p-6 text-sm leading-relaxed">
		<header class="flex flex-col gap-1">
			<h1 class="text-lg font-semibold">privacy</h1>
			<p class="text-xs text-muted-foreground">last updated {updated}</p>
		</header>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">without an account</h2>
			<p class="text-muted-foreground">
				you can browse events, matches and video without signing up, and we do not store anything
				about you for it. there are no ads and no third-party analytics anywhere in matcha.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">with an account</h2>
			<p class="text-muted-foreground">we keep:</p>
			<ul class="ml-4 flex list-disc flex-col gap-1 text-muted-foreground">
				<li>your email address, so you can sign in and get a password reset</li>
				<li>your display name, which everyone in a match chat can see</li>
				<li>your password, stored scrambled in a way we cannot reverse</li>
				<li>the messages you post, and which match you posted them in</li>
				<li>your sign-in sessions, including the ip address and browser they started from</li>
				<li>
					moderation records: messages the filter refused, mutes and bans, reports you have made,
					and people you have blocked
				</li>
			</ul>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">who sees what</h2>
			<p class="text-muted-foreground">
				your display name and your messages are public to anyone using matcha. your email is not:
				only you and moderators can see it. moderators can also see messages the filter refused and
				anything reported about you, because that is what they are deciding on.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">who else it touches</h2>
			<p class="text-muted-foreground">
				matcha runs on vercel, stores data with turso, and sends mail through resend — your address
				passes through resend to reach you. youtube serves the video players, and youtube sees you
				watching them under google's own policy. robotevents supplies event and match data and gets
				nothing about you.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">how long</h2>
			<p class="text-muted-foreground">
				until you delete your account, which you can do from
				<a class="underline" href={resolve('/(app)/account')}>your account</a>. that removes the
				account, your messages, your blocks, your reports, and your moderation history in one go,
				and it cannot be undone. deleted messages leave a gap in a conversation rather than a
				tombstone.
			</p>
			<p class="text-muted-foreground">
				a message a moderator removes is hidden from chat immediately but kept, so the moderator can
				still see what they acted on. it goes when the account that posted it goes.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">asking us things</h2>
			<p class="text-muted-foreground">
				{#if supportEmail}
					email <a class="underline" href="mailto:{supportEmail}">{supportEmail}</a> for a copy of what
					we hold about you, to correct it, or to ask anything about this page.
				{:else}
					reply to any email matcha has sent you for a copy of what we hold about you, to correct
					it, or to ask anything about this page.
				{/if}
			</p>
		</section>

		<a class="text-xs text-muted-foreground underline" href={resolve('/terms')}>terms of use</a>
	</article>
</div>
