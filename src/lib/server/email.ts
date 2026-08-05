import { Resend } from 'resend';
import { env } from '$env/dynamic/private';

export type Email = {
	to: string;
	subject: string;
	text: string;
	html: string;
};

/**
 * Built on first use rather than at import: `$env/dynamic/private` is empty while vite is
 * prerendering, so reading the key at module scope would decide "no mail" for the whole process.
 */
let client: Resend | null = null;

function resend(apiKey: string) {
	client ??= new Resend(apiKey);
	return client;
}

/**
 * Sends transactional mail through resend.
 *
 * With no `RESEND_API_KEY` the message is logged instead of sent, so a local checkout can walk the
 * whole verification flow by copying the link out of the dev server output.
 */
export async function sendEmail(email: Email): Promise<void> {
	const apiKey = env.RESEND_API_KEY;
	const from = env.EMAIL_FROM;

	if (!apiKey || !from) {
		console.info(
			`[email] no RESEND_API_KEY/EMAIL_FROM, not sending. to=${email.to} subject=${email.subject}\n${email.text}`
		);
		return;
	}

	const { error } = await resend(apiKey).emails.send({
		from,
		to: email.to,
		subject: email.subject,
		text: email.text,
		html: email.html
	});

	// the sdk hands failures back in the result rather than throwing, and better-auth only knows a
	// send went wrong if this does throw
	if (error) throw new Error(`resend rejected the message: ${error.name} — ${error.message}`);
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * The one shape every message we send takes: a greeting, a line about why this arrived, one button,
 * the same link in plain text for the clients that swallow buttons, and a footer.
 *
 * Colours are the theme's own, but mail clients drop declarations they cannot parse, so every rule
 * here has to still read fine when it is thrown away.
 */
function linkEmail(input: {
	to: string;
	name: string;
	subject: string;
	lead: string;
	action: string;
	url: string;
	footer: string;
}): Email {
	const greeting = input.name.trim() || 'there';
	const href = escapeHtml(input.url);

	return {
		to: input.to,
		subject: input.subject,
		text: [`hey ${greeting},`, '', input.lead, input.url, '', input.footer].join('\n'),
		html: `<div style="font-family: 'Instrument Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.6; max-width: 480px;">
	<p>hey ${escapeHtml(greeting)},</p>
	<p>${escapeHtml(input.lead)}</p>
	<p>
		<a
			href="${href}"
			style="display: inline-block; padding: 10px 18px; border-radius: 7px; background: oklch(0.768 0.233 130.85); color: oklch(0.405 0.101 131.063); font-weight: 600; text-decoration: none;"
			>${escapeHtml(input.action)}</a
		>
	</p>
	<p>or paste this into your browser:<br /><a href="${href}">${href}</a></p>
	<p style="color: oklch(0.58 0.031 107.3);">${escapeHtml(input.footer)}</p>
</div>`
	};
}

/** The confirm-your-address message. */
export function verificationEmail({ to, name, url }: { to: string; name: string; url: string }) {
	return linkEmail({
		to,
		name,
		url,
		subject: 'confirm your matcha email',
		lead: 'confirm this address to finish setting up your matcha account:',
		action: 'confirm email',
		footer: 'the link is good for one hour. if you did not sign up, ignore this email.'
	});
}

/**
 * The reset-your-password message. The footer matters more than usual here: this is the one piece
 * of mail a stranger can make somebody else's inbox receive, so it has to say plainly that ignoring
 * it costs nothing.
 */
export function passwordResetEmail({ to, name, url }: { to: string; name: string; url: string }) {
	return linkEmail({
		to,
		name,
		url,
		subject: 'reset your matcha password',
		lead: 'set a new password for your matcha account:',
		action: 'choose a new password',
		footer:
			'the link is good for one hour. if you did not ask for it, ignore this email — your password stays as it is.'
	});
}

/** Confirms a deletion request before anything is actually removed. */
export function accountDeletionEmail({ to, name, url }: { to: string; name: string; url: string }) {
	return linkEmail({
		to,
		name,
		url,
		subject: 'confirm deleting your matcha account',
		lead: 'confirm that you want your matcha account and everything you have posted deleted:',
		action: 'delete my account',
		footer:
			'the link is good for one hour, and this cannot be undone. if you did not ask for it, ignore this email.'
	});
}
