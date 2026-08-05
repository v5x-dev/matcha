/**
 * Rule-based chat automod. Pure: no database, no clock, no request context, so the rules can be
 * reasoned about (and tested) on their own. `reviewMessage` is the only entry point the rest of the
 * app should need.
 *
 * The design assumption is a mostly-teenage robotics audience trash-talking about matches. Heat is
 * fine — "your drivers are dogwater" is the point of the app. Slurs, sexual content, threats, scam
 * links and flooding are not.
 */

export type AutomodAction = 'allow' | 'flag' | 'block';

export type AutomodVerdict = {
	action: AutomodAction;
	/** short machine-readable id of the rule that fired, for strike counting and mod queues. */
	rule: string | null;
	/** lowercase, shown straight to the sender when the action is `block`. */
	reason: string | null;
	/** 1 mild, 2 serious, 3 zero-tolerance. drives how fast strikes escalate into a mute. */
	severity: 0 | 1 | 2 | 3;
	/** the text to store when the message is allowed through: trimmed and de-obfuscated. */
	body: string;
};

/** characters that only exist to smuggle a banned word past a substring check. */
const INVISIBLE =
	// eslint-disable-next-line no-misleading-character-class
	/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff]/g;

/**
 * Combining marks, i.e. the zalgo trick. Matching them on their own is the entire point here — the
 * lint rule guards against splitting a grapheme by accident, which is exactly what this wants.
 */
const COMBINING =
	// eslint-disable-next-line no-misleading-character-class
	/[\u0300-\u036f\u0483-\u0489\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20f0\ufe20-\ufe2f]/g;

const LEET: Record<string, string> = {
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'4': 'a',
	'5': 's',
	'6': 'g',
	'7': 't',
	'8': 'b',
	'9': 'g',
	'@': 'a',
	$: 's',
	'!': 'i',
	'|': 'i',
	'+': 't',
	'(': 'c',
	'€': 'e',
	'£': 'l'
};

/**
 * What actually gets stored when a message is allowed: invisible characters and zalgo stripped,
 * absurd character runs and whitespace collapsed. Everything else is left exactly as typed.
 */
export function cleanForStorage(input: string): string {
	return (
		input
			.normalize('NFKC')
			.replace(INVISIBLE, '')
			.replace(COMBINING, '')
			// "noooooooo" survives, "noooo…×200" does not
			.replace(/(.)\1{7,}/gu, '$1$1$1$1$1$1$1')
			.replace(/[^\S\n]{3,}/g, ' ')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

/**
 * Aggressively flattened form used only for matching: leetspeak folded back to letters, repeats
 * collapsed, and everything that is not a letter or digit removed. `f.u_c-k` and `fuuuuck` and
 * `f<zero-width space>uck` all land on the same string, which is what makes a word list worth having at all.
 */
function flatten(input: string): string {
	const folded = input
		.normalize('NFKD')
		.replace(INVISIBLE, '')
		.replace(COMBINING, '')
		.toLowerCase()
		.split('')
		.map((character) => LEET[character] ?? character)
		.join('');

	return folded.replace(/(.)\1+/g, '$1').replace(/[^a-z0-9]/g, '');
}

/** the same flattening, but keeping word boundaries so whole-word rules can still anchor. */
function flattenWords(input: string): string[] {
	return input
		.normalize('NFKD')
		.replace(INVISIBLE, '')
		.replace(COMBINING, '')
		.toLowerCase()
		.split('')
		.map((character) => LEET[character] ?? character)
		.join('')
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.map((word) => word.replace(/(.)\1+/g, '$1'));
}

/**
 * Severity 3: matched against the flattened string, so spacing and punctuation tricks do not help.
 * Deliberately short — it is only for terms with no innocent reading, because flattened substring
 * matching is blunt and anything ambiguous belongs in the word-boundary lists below.
 *
 * Stored rot13-encoded so the source file is not itself a wall of slurs; decoded once at load.
 */
const SLUR_FRAGMENTS_ROT13 = [
	'avttre',
	'avttn',
	'snttbg',
	'genaal',
	'xvxr',
	'puvax',
	'fcvpx',
	'jrgonpx',
	'gbjryurnq',
	'ergneq'
];

/**
 * Flattening collapses repeated letters, so the fragment for one slur is also a substring of a few
 * entirely innocent words — "nigeria" being the well-known one. Words listed here are dropped
 * before the substring check runs, which keeps the check able to see through spaced-out evasion
 * ("n i g g e r") without turning a team's location into a 24-hour mute.
 */
const SLUR_EXCEPTIONS = [
	'niger',
	'nigeria',
	'nigerian',
	'nigerien',
	'retardant',
	'retardants',
	'retardation',
	'flameretardant'
];

function rot13(input: string): string {
	return input.replace(/[a-z]/g, (character) =>
		String.fromCharCode(((character.charCodeAt(0) - 97 + 13) % 26) + 97)
	);
}

const SLUR_FRAGMENTS = SLUR_FRAGMENTS_ROT13.map(rot13).map(flatten);

/**
 * Severity 2: threats. These run against the flattened word stream, where repeated letters have
 * already been collapsed ("kill" arrives as "kil"), so every doubled letter in a canonical spelling
 * is written with a `+`. That is also what makes "kiiiill" match.
 *
 * Kept deliberately narrow. "we're going to beat you" and "that bot is dead" are how people talk
 * about matches; only phrasings with no competitive reading belong here.
 */
const THREAT_PATTERNS = [
	/\bkys\b/,
	/\b(kil+|hang|neck|of+)\s*(your?sel+f?|ursel+f?)\b/,
	/\b(sho+t|stab|shank)\s*(you|u|him|her|them|em)\b/,
	/\bi(m|l+|ll be)?\s*(gon+a|going to|wil+)\s*(find|hunt|kil+|hurt)\s*(you|u|him|her|them|em)\b/,
	/\bswat+(ing|ed)?\s*(you|u|him|her|them)\b/,
	/\b(go\s*)?(kil+|of+)\s*(your?sel+f?)\b/
];

const SEXUAL_WORDS = [
	'porn',
	'pornhub',
	'nude',
	'nudes',
	'onlyfans',
	'blowjob',
	'handjob',
	'cum',
	'jerkoff',
	'masturbate',
	'hentai',
	'rape',
	'molest',
	'pedo',
	'pedophile'
];

/**
 * Not blocked: a scouting chat that cannot call a robot garbage is not worth having. These only
 * raise a flag so the mod queue has something to sort by when a match gets genuinely nasty.
 */
const INSULT_WORDS = ['idiot', 'stupid', 'moron', 'loser', 'pathetic', 'trash', 'garbage', 'suck'];

/** Severity 1: ordinary swearing. Blocked, but with a friendly reason and a slow escalation. */
const PROFANITY_WORDS = [
	'fuck',
	'fucking',
	'fucker',
	'motherfucker',
	'shit',
	'bullshit',
	'bitch',
	'bastard',
	'asshole',
	'dickhead',
	'cunt',
	'whore',
	'slut',
	'dumbass',
	'jackass',
	'prick',
	'wanker',
	'douchebag'
];

/** link destinations worth allowing in a scouting chat; anything else reads as spam or a scam. */
const ALLOWED_LINK_HOSTS = [
	'youtube.com',
	'youtu.be',
	'twitch.tv',
	'robotevents.com',
	'vexforum.com',
	'vexrobotics.com',
	'kb.roboticseducation.org',
	'recf.org'
];

const URL_PATTERN =
	/\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|gg|tv|xyz|ru|link|shop|store|club|online|site|info|biz|co|me|to|cc)\b(?:\/[^\s]*)?/gi;

const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

/** long digit runs, ignoring the punctuation people put in phone numbers. */
const PHONE_PATTERN = /(?:\+?\d[\s().-]?){10,}/;

/**
 * A run of ten or more digits is not enough on its own: "45 88 102 76 39 12 55 91 20 8" is ten
 * match scores, and this is a scouting app, so lists of numbers are ordinary conversation. Real
 * phone numbers group their digits a handful of times at most, which is what separates the two.
 */
const MAX_PHONE_SEPARATORS = 4;

function looksLikePhoneNumber(body: string): boolean {
	const run = body.match(PHONE_PATTERN)?.[0];
	if (!run) return false;

	return (run.match(/[\s().-]/g) ?? []).length <= MAX_PHONE_SEPARATORS;
}

const SLUR_SET = new Set(SLUR_FRAGMENTS);
const SLUR_EXCEPTION_SET = new Set(SLUR_EXCEPTIONS.map(flatten));
const PROFANITY_TERMS = PROFANITY_WORDS.map(flatten);
const SEXUAL_TERMS = SEXUAL_WORDS.map(flatten);
const INSULT_SET = new Set(INSULT_WORDS.map(flatten));
const SECOND_PERSON = new Set(['you', 'u', 'ur', 'your', 'yall'].map(flatten));

/**
 * A term hits a word when they are equal, or — for terms long enough that a coincidence is
 * implausible — when the word contains it, which is what catches `fuckyou` written as one token.
 * The floor matters: "document" contains "cum", so three-letter terms only ever match whole words.
 */
const CONTAINMENT_FLOOR = 4;

/** real words that contain a banned term. the Scunthorpe list, in other words. */
const WORD_EXCEPTIONS = new Set(
	['scunthorpe', 'shitake', 'shiitake', 'prickly', 'prickle', 'prickled', 'penistone'].map(flatten)
);

function hitsTerm(words: string[], terms: string[]): boolean {
	return words.some((word) => {
		if (WORD_EXCEPTIONS.has(word)) return false;

		return terms.some(
			(term) => word === term || (term.length >= CONTAINMENT_FLOOR && word.includes(term))
		);
	});
}

/**
 * "f u c k this ref" arrives as six tokens, five of which are one letter long. Runs of single
 * letters are the standard way round a word list, and gluing them back together is safe precisely
 * because nobody writes real prose one letter at a time.
 */
function mergeLetterRuns(words: string[]): string[] {
	const merged: string[] = [];
	let run: string[] = [];

	const flush = () => {
		if (run.length >= 2) merged.push(run.join(''));
		run = [];
	};

	for (const word of words) {
		if (word.length === 1) {
			run.push(word);
			continue;
		}

		flush();
		merged.push(word);
	}

	flush();

	return merged;
}

function hostOf(rawUrl: string): string | null {
	const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

	try {
		return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return null;
	}
}

function isAllowedHost(host: string): boolean {
	return ALLOWED_LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function verdict(
	action: AutomodAction,
	rule: string | null,
	reason: string | null,
	severity: AutomodVerdict['severity'],
	body: string
): AutomodVerdict {
	return { action, rule, reason, severity, body };
}

/**
 * Run every rule over one message. Rules are ordered worst-first so the reason the sender sees is
 * the most serious thing they did, not the first one alphabetically.
 */
export function reviewMessage(input: string): AutomodVerdict {
	const body = cleanForStorage(input);

	if (body.length === 0) {
		return verdict('block', 'empty', 'say something first', 0, body);
	}

	// letter-spaced evasion is glued back together before any word list sees the message
	const words = mergeLetterRuns(flattenWords(body));

	// severity 3 — slurs. matched against the words run together, so "n i g g e r" is caught too,
	// but with known-innocent words removed first so "nigeria" is not
	const flat = words.filter((word) => !SLUR_EXCEPTION_SET.has(word)).join('');
	for (const fragment of SLUR_SET) {
		if (fragment.length > 0 && flat.includes(fragment)) {
			return verdict('block', 'slur', 'that language is not allowed here', 3, body);
		}
	}

	// severity 2 — threats
	const spaced = words.join(' ');
	for (const pattern of THREAT_PATTERNS) {
		if (pattern.test(spaced)) {
			return verdict('block', 'threat', 'threats are not allowed here', 2, body);
		}
	}

	// severity 2 — sexual content
	if (hitsTerm(words, SEXUAL_TERMS)) {
		return verdict('block', 'sexual', 'keep it about the robots', 2, body);
	}

	// checked before links so an email address is not reported back as a link problem
	if (EMAIL_PATTERN.test(body) || looksLikePhoneNumber(body)) {
		return verdict('block', 'contact-info', 'do not post contact details in chat', 1, body);
	}

	// links: unknown hosts are the usual shape of chat spam and follower scams
	const urls = body.match(URL_PATTERN) ?? [];
	for (const rawUrl of urls) {
		const host = hostOf(rawUrl);
		if (!host || !isAllowedHost(host)) {
			return verdict(
				'block',
				'link',
				'links are only allowed to youtube, twitch, robotevents and vex sites',
				1,
				body
			);
		}
	}

	// severity 1 — ordinary swearing
	if (hitsTerm(words, PROFANITY_TERMS)) {
		return verdict('block', 'profanity', 'keep chat clean', 1, body);
	}

	// shouting
	const letters = body.replace(/[^a-z]/gi, '');
	const capitals = body.replace(/[^A-Z]/g, '');
	if (letters.length >= 12 && capitals.length / letters.length > 0.7) {
		return verdict('block', 'caps', 'turn off caps lock', 1, body);
	}

	// one word (or a short phrase) pasted over and over. the floor is eight rather than six so that
	// chanting a two-word phrase three times — which is what a crowd does — is not spam
	if (words.length >= 8) {
		const distinct = new Set(words);
		if (distinct.size <= Math.ceil(words.length / 4)) {
			return verdict('block', 'repetition', 'that is just the same thing repeated', 1, body);
		}
	}

	// borderline stuff a human should see, but not worth stopping mid-match. an insult aimed at a
	// person ("you are pathetic") reads differently from one aimed at a robot ("that intake sucks")
	const aimedAtSomeone = words.some((word) => SECOND_PERSON.has(word));
	if (aimedAtSomeone && words.some((word) => INSULT_SET.has(word))) {
		return verdict('flag', 'insult', null, 0, body);
	}

	if (urls.length > 2) {
		return verdict('flag', 'many-links', null, 0, body);
	}

	return verdict('allow', null, null, 0, body);
}
