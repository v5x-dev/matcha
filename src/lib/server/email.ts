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
 * The confirm-your-address message. Colours are the theme's own, but mail clients drop declarations
 * they cannot parse, so every rule here has to still read fine when it is thrown away.
 */
export function verificationEmail({ to, name, url }: { to: string; name: string; url: string }) {
	const greeting = name.trim() || 'there';
	const href = escapeHtml(url);

	return {
		to,
		subject: 'confirm your matcha email',
		text: [
			`hey ${greeting},`,
			'',
			'confirm this address to finish setting up your matcha account:',
			url,
			'',
			'the link is good for one hour. if you did not sign up, ignore this email.'
		].join('\n'),
		html: `<div style="font-family: 'Instrument Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.6; max-width: 480px;">
	<p>hey ${escapeHtml(greeting)},</p>
	<p>confirm this address to finish setting up your matcha account.</p>
	<p>
		<a
			href="${href}"
			style="display: inline-block; padding: 10px 18px; border-radius: 7px; background: oklch(0.768 0.233 130.85); color: oklch(0.405 0.101 131.063); font-weight: 600; text-decoration: none;"
			>confirm email</a
		>
	</p>
	<p>or paste this into your browser:<br /><a href="${href}">${href}</a></p>
	<p style="color: oklch(0.58 0.031 107.3);">
		the link is good for one hour. if you did not sign up, ignore this email.
	</p>
</div>`
	} satisfies Email;
}
