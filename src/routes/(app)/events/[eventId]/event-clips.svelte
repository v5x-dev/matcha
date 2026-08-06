<script lang="ts">
	import { resolve } from '$app/paths';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { activeClipId, activeMatchId, requestClipRestart } from '$lib/match-param.svelte';
	import { chatViewerState } from '$lib/remote/chat.remote';
	import { deleteClip, listEventClips, type EventClip } from '$lib/remote/clip.remote';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import Fuse from 'fuse.js';
	import { toast } from 'svelte-sonner';
	import type { MatchData } from 'events.vex';

	type ClipUser = { id: string; name: string };

	let {
		eventId,
		matches,
		clips: initialClips,
		user,
		query
	}: {
		eventId: number;
		matches: MatchData[];
		clips: EventClip[];
		user: ClipUser | null;
		query: string;
	} = $props();

	const sidebar = Sidebar.useSidebar();
	const clipsQuery = $derived(listEventClips(eventId));
	const clips = $derived(clipsQuery.current ?? initialClips);
	const viewerQuery = chatViewerState();
	const canModerate = $derived(viewerQuery.current?.canModerate ?? false);

	function matchName(matchId: number): string {
		return matches.find((match) => match.id === matchId)?.name.toLowerCase() ?? `match ${matchId}`;
	}

	function formatTime(seconds: number): string {
		const total = Math.max(0, Math.floor(seconds));
		const minutes = Math.floor(total / 60);
		return `${minutes}:${(total % 60).toString().padStart(2, '0')}`;
	}

	const filteredClips = $derived.by(() => {
		const trimmed = query.trim();
		if (!trimmed) return clips;

		const fuse = new Fuse(
			clips.map((clip) => ({
				id: clip.id,
				title: clip.title,
				matchName: matchName(clip.matchId),
				authorName: clip.authorName
			})),
			{ keys: ['title', 'matchName', 'authorName'], threshold: 0.35, ignoreLocation: true }
		);
		const ids = new Set(fuse.search(trimmed).map((result) => result.item.id));

		return clips.filter((clip) => ids.has(clip.id));
	});

	function handleClipClick(event: MouseEvent, clip: EventClip) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;

		if (sidebar.isMobile) sidebar.setOpenMobile(false);

		if (clip.id !== activeClipId() || clip.matchId !== activeMatchId()) return;

		event.preventDefault();
		requestClipRestart(clip.id);
	}

	function reasonFrom(error: unknown, fallback: string): string {
		const body = (error as { body?: { message?: string } } | undefined)?.body;
		return body?.message ?? fallback;
	}

	async function remove(clipId: string) {
		try {
			await deleteClip({ clipId });
			await clipsQuery.refresh();
		} catch (error) {
			toast.error(reasonFrom(error, 'could not delete that clip'));
		}
	}
</script>

<Sidebar.Content class="clips-sidebar-scroll min-h-0 overflow-y-auto px-2">
	{#if filteredClips.length === 0}
		<p class="m-auto px-3 py-6 text-center text-xs text-sidebar-foreground!">
			{query.trim() ? 'no clips found' : 'no clips yet'}
		</p>
	{:else}
		<div class="flex flex-col gap-1 py-1">
			{#each filteredClips as clip (clip.id)}
				{@const own = clip.authorId === user?.id}
				<div
					class="group flex min-w-0 items-start gap-1 rounded-xl px-1 transition-colors hover:bg-sidebar-accent"
					data-sidebar-clip-id={clip.id}
				>
					<a
						class="min-w-0 flex-1 px-2 py-2"
						href={resolve(`/(app)/events/[eventId]?match=${clip.matchId}&clip=${clip.id}`, {
							eventId: eventId.toString()
						})}
						aria-current={clip.id === activeClipId() ? 'page' : undefined}
						onclick={(event) => handleClipClick(event, clip)}
					>
						<span class="block truncate text-sm font-medium">{clip.title}</span>
						<span class="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
							<span class="truncate">{matchName(clip.matchId)}</span>
							<span aria-hidden="true">·</span>
							<span class="shrink-0">{formatTime(clip.endSeconds - clip.startSeconds)}</span>
						</span>
						<span class="mt-0.5 block truncate text-xs text-muted-foreground">
							by {clip.authorName.toLowerCase()}
						</span>
					</a>

					{#if user && (own || canModerate)}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="mt-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
								aria-label="clip actions"
							>
								<EllipsisIcon class="size-3.5" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-40">
								<DropdownMenu.Item onSelect={() => void remove(clip.id)}>
									<TrashIcon class="size-3.5" />
									delete clip
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</Sidebar.Content>

<style>
	:global(.clips-sidebar-scroll) {
		scrollbar-width: thin;
		scrollbar-color: var(--sidebar-border) transparent;
	}

	:global(.clips-sidebar-scroll::-webkit-scrollbar) {
		display: block;
		width: 0.625rem;
	}

	:global(.clips-sidebar-scroll::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(.clips-sidebar-scroll::-webkit-scrollbar-thumb) {
		border: 2px solid transparent;
		border-radius: 999px;
		background: var(--sidebar-border);
		background-clip: padding-box;
	}
</style>
