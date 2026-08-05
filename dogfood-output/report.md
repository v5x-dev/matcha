# Dogfood Report: matcha

| Field | Value |
|-------|-------|
| **Date** | 2026-08-05 |
| **App URL** | http://localhost:5173 |
| **Session** | matcha-pre-ship |
| **Scope** | Full app, excluding chat |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Issues

### ISSUE-001: Refreshing `/events` destroys the event list

| Field | Value |
|-------|-------|
| **Severity** | critical |
| **Category** | functional / console |
| **URL** | http://127.0.0.1:5173/events |
| **Repro Video** | videos/issue-001-stable-repro.webm |

**Description**

The events list works after navigating from the landing page, but refreshing the same `/events` URL leaves a blank page while the address bar and document title still identify `/events`. The console reports a Svelte `hydration_mismatch`. During an earlier hot-reload window the same mismatch rendered the signed-out account screen at `/events`; on a freshly started server it reproduces consistently as a blank page. Direct links and refreshes therefore cannot be trusted to render the requested route.

**Repro Steps**

1. Navigate from the landing page to the working events list.
   ![Step 1](screenshots/issue-001-stable-step-1.png)

2. Refresh the page and wait for it to settle.

3. **Observe:** the URL remains `/events`, but the rendered page is blank rather than the event list.
   ![Result](screenshots/issue-001-stable-result.png)

---
