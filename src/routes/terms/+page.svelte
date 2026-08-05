<script lang="ts">
	/**
	 * Draft terms. Written to describe what the code actually does rather than to be exhaustive, so
	 * every claim here can be checked against `src/lib/server/automod.ts` and `moderation.ts`.
	 *
	 * This has not been through a lawyer. It is a starting point for one, not a substitute.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const supportEmail = $derived(page.data.supportEmail);
	const updated = 'august 2026';
</script>

<svelte:head>
	<title>terms · matcha</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<article class="mx-auto flex max-w-2xl flex-col gap-6 p-6 text-sm leading-relaxed">
		<header class="flex flex-col gap-1">
			<h1 class="text-lg font-semibold">terms of use</h1>
			<p class="text-xs text-muted-foreground">last updated {updated}</p>
		</header>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">what matcha is</h2>
			<p class="text-muted-foreground">
				matcha lines up vex v5 match footage with match results so you can watch what happened and
				argue about it. event and match data comes from robotevents, video comes from youtube, and
				neither of them is us.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">who can use it</h2>
			<p class="text-muted-foreground">
				you need to be at least 13 to make an account. if you are under 18, ask whoever is
				responsible for you before you sign up. anyone can watch without an account; you only need
				one to post in chat.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">chat</h2>
			<p class="text-muted-foreground">
				trash talk about robots is the point. "your drivers are dogwater" is fine. these are not:
			</p>
			<ul class="ml-4 flex list-disc flex-col gap-1 text-muted-foreground">
				<li>slurs, or anything aimed at who somebody is rather than how they drove</li>
				<li>threats, wishing harm on anybody, or anything sexual</li>
				<li>harassment, including following one person from match to match</li>
				<li>scam links, ads, and flooding the same message over and over</li>
				<li>anyone's personal details, including your own</li>
			</ul>
			<p class="text-muted-foreground">
				an automatic filter blocks some of this before it posts and flags the rest for a human. what
				you post is yours; posting it here gives us permission to show it to other people using
				matcha, and nothing else.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">when we mute or ban you</h2>
			<p class="text-muted-foreground">
				a first blocked message is a nudge. repeats inside an hour turn into a mute that gets longer
				each time. slurs skip the ladder and mute for a day. moderators can also mute or delete by
				hand, and admins can ban with no end date.
			</p>
			<p class="text-muted-foreground">
				the filter gets things wrong, and so do people. if you think a mute is wrong, say so and a
				human will look again —
				{#if supportEmail}
					email <a class="underline" href="mailto:{supportEmail}">{supportEmail}</a> with your display
					name and roughly when it happened.
				{:else}
					reply to any email matcha has sent you with your display name and roughly when it
					happened.
				{/if}
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">your account</h2>
			<p class="text-muted-foreground">
				keep your password to yourself; what happens under your account is treated as you. you can
				delete the account and everything you have posted at any time from
				<a class="underline" href={resolve('/(app)/account')}>your account</a>. we can close an
				account that keeps breaking the rules above.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">the boring part</h2>
			<p class="text-muted-foreground">
				matcha is provided as is, with no promise that it is available, correct, or that a video
				lines up with the match it claims to. match data and video belong to their sources and can
				change or disappear without warning. do not rely on any of it for anything that matters,
				like a protest at an event.
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="font-medium">changes</h2>
			<p class="text-muted-foreground">
				if these change in a way that affects what you can post or what happens to your account, the
				date at the top changes with them.
			</p>
		</section>

		<a class="text-xs text-muted-foreground underline" href={resolve('/privacy')}>
			privacy policy
		</a>
	</article>
</div>
