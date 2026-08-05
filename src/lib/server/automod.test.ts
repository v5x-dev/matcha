import { describe, expect, it } from 'vitest';
import { cleanForStorage, reviewMessage } from './automod';

const action = (message: string) => reviewMessage(message).action;
const rule = (message: string) => reviewMessage(message).rule;

describe('reviewMessage: things people actually say', () => {
	/**
	 * The corpus that matters most. Every one of these is a plausible message in a scouting chat,
	 * and every one of them is the kind of thing a word list built out of substrings gets wrong.
	 */
	const allowed = [
		'their drivers are dogwater',
		'that intake sucks so bad',
		'we got absolutely cooked in the last match',
		'3796B has the best auton at this event',
		'the whole class of 2027 is stacked',
		'assassin bot strategy, just deny the goal',
		'the documentation for the brain is useless',
		'cummins sponsors their team apparently',
		'they are from nigeria, first time at worlds',
		'shiitake mushrooms, their team name is unhinged',
		'scunthorpe college has a team now',
		'prickly situation for red alliance',
		'analysis of that skills run please',
		'lets go lets go lets go',
		'scores were 45 88 102 76 39 12 55 91 20 8',
		'match 1 2 and 3 were all blowouts',
		'https://www.youtube.com/watch?v=abc123 look at this pin',
		'https://robotevents.com/robot-competitions/vex-robotics-competition full results here',
		'GG',
		'WOW',
		'that was a dub'
	];

	for (const message of allowed) {
		it(`allows "${message}"`, () => {
			expect(action(message)).toBe('allow');
		});
	}
});

describe('reviewMessage: the lines worth holding', () => {
	it('blocks slurs at severity 3', () => {
		const verdict = reviewMessage('you are such a f4990t');

		expect(verdict.action).toBe('block');
		expect(verdict.rule).toBe('slur');
		expect(verdict.severity).toBe(3);
	});

	it('sees through letter spacing', () => {
		expect(rule('f u c k this ref')).toBe('profanity');
	});

	it('sees through leetspeak', () => {
		expect(rule('sh1t call by that ref')).toBe('profanity');
	});

	it('sees through repeated letters', () => {
		expect(rule('fuuuuuck that')).toBe('profanity');
	});

	it('sees through zero-width characters', () => {
		expect(rule('f​uck that call')).toBe('profanity');
	});

	it('blocks threats but not competitive trash talk', () => {
		expect(rule('kys')).toBe('threat');
		expect(rule('im gonna find you')).toBe('threat');
		expect(action('we are going to destroy them next match')).toBe('allow');
		expect(action('their bot is dead on the field')).toBe('allow');
	});

	it('blocks sexual content', () => {
		expect(rule('go watch porn instead')).toBe('sexual');
	});

	it('blocks contact details', () => {
		expect(rule('dm me at scout@example.com')).toBe('contact-info');
		expect(rule('call me on 555 123 4567')).toBe('contact-info');
	});

	it('blocks links to anywhere it does not know', () => {
		expect(rule('free v5 parts at sketchy-giveaway.xyz')).toBe('link');
		expect(action('clip is at https://www.twitch.tv/videos/1 ')).toBe('allow');
	});

	it('blocks shouting, once there is enough of it to be shouting', () => {
		expect(rule('THAT REF CALL WAS ABSURD')).toBe('caps');
		expect(action('GG WP')).toBe('allow');
	});

	it('blocks the same phrase pasted over and over', () => {
		expect(rule('lets go lets go lets go lets go lets go')).toBe('repetition');
	});

	it('blocks an empty message', () => {
		expect(rule('   ')).toBe('empty');
	});
});

describe('reviewMessage: things a human should see but not be stopped over', () => {
	it('flags an insult aimed at a person, not at a robot', () => {
		expect(reviewMessage('you are pathetic')).toMatchObject({ action: 'flag', rule: 'insult' });
		expect(action('that autonomous is garbage')).toBe('allow');
	});

	it('flags a message that is mostly links', () => {
		const verdict = reviewMessage(
			'https://youtu.be/dQw4w9WgXcQ https://youtu.be/kJQP7kiw5Fk https://youtu.be/9bZkp7q19f0'
		);

		expect(verdict).toMatchObject({ action: 'flag', rule: 'many-links' });
	});

	it('never flags at a severity that would escalate into a mute', () => {
		expect(reviewMessage('you are pathetic').severity).toBe(0);
	});
});

describe('cleanForStorage', () => {
	it('keeps the message as typed', () => {
		expect(cleanForStorage('  their intake is CRACKED  ')).toBe('their intake is CRACKED');
	});

	it('strips invisible characters and zalgo', () => {
		expect(cleanForStorage('he​llo')).toBe('hello');
		expect(cleanForStorage('h́ello')).toBe('hello');
	});

	it('lets emphasis through but not a wall of it', () => {
		expect(cleanForStorage('nooooo')).toBe('nooooo');
		expect(cleanForStorage(`no${'o'.repeat(200)}`)).toBe('nooooooo');
	});

	it('collapses runs of whitespace without touching single line breaks', () => {
		expect(cleanForStorage('red     alliance')).toBe('red alliance');
		expect(cleanForStorage('red\n\n\n\n\nalliance')).toBe('red\n\nalliance');
	});
});
