import { VEX_EVENTS_TOKEN } from '$env/static/private';
import { Client } from 'events.vex';

const vex = Client({ authorization: { token: VEX_EVENTS_TOKEN } });

export default vex;
