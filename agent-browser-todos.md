# agent-browser todos

- v0.3.2 (extension v0.0.23): session `tidy-panda-247` returned
  `net::ERR_CONNECTION_REFUSED` navigating to
  `http://localhost:5174/events/59997?match=117251125`; expected the local event page,
  but the development server was listening on port 5173 after the previous server stopped.
  Recovery: checked the listening ports and retried against port 5173.

- v0.3.2 (extension v0.0.23): session `brisk-sparrow-795` returned
  `SyntaxError: Unexpected identifier 'as'` when a page probe used TypeScript's
  `as HTMLButtonElement` assertion inside browser JavaScript. Expected the DOM
  probe result; recovery: rerun the same read with plain JavaScript syntax.

- v0.3.2 (extension v0.0.23): session `lucky-wombat-452` wedged while reading the
  `get started` link after clicking it on `http://127.0.0.1:5174/`. Reproduction:
  click the landing-page link, then read its `href` and `outerHTML`; expected a
  prompt result, but the command produced no result for about 28 seconds while
  the session reported a pending `/events` page URL. Recovery: checked
  `agent-browser status --json`, then a minimal `page.url()` execute restored
  normal operation. Subsequent snapshots and layout measurements succeeded.

- v0.3.2 (extension v0.0.23): session `quiet-panda-770` received
  `net::ERR_CONNECTION_REFUSED` navigating to
  `http://127.0.0.1:5173/events/59997`; expected the local event page, but no
  development server was listening. Recovery: started the project development
  server on port 5174 and successfully retried the event page there.

- v0.3.2 (extension v0.0.23): session `quiet-panda-770` produced
  `ReferenceError: window is not defined` while reading an event-sidebar height
  probe because the script referenced `window` in the driver context. Expected
  the probe recorded in the page context. Recovery: corrected the read to use
  `page.evaluate`; subsequent browser recording and visual inspection worked.

- v0.3.2 (extension v0.0.23): session `lucky-falcon-017` returned
  `page.goto: Page crashed` navigating to
  `http://localhost:5173/events/59997?match=117251125` after setting the relay-owned
  page viewport to `252x970`. Expected the narrow event sidebar page to load and
  retain the match query, but the page target crashed before `domcontentloaded`.
  Recovery attempted: checked `agent-browser status --json` and confirmed the
  relay/session remained connected; continuing visual checks at a normal viewport.
