# Tunnel: the week span (kept, not in use)

The Tunnel view had a **week** span: a box = a week (Mon → Sun), a row = a day, a 2-row dark band between weeks. Each day's label was on the floor (3 cells wide), all of its tasks were on the walls, and up to 3 photos per day (8 in Gallery mode) went around them.

The owner dropped it on 2026-11-21. Day → month → year cover it, and it must not go to `main`. It is kept here in case it is needed one day (P-62 / #191).

**To bring it back** (from the repo root):

```
git apply src/components/calendar/tunnel/week/week-span.patch
```

The patch adds the span to `scale.ts` (with its test), the week layout to `passage.ts` and the week's media cap and title to `TunnelCalendar.tsx`. The zoom buttons pick it up from `SPANS` by themselves. It was made against commit `3ea5097`. If the code has moved on and it no longer applies, the complete working version is commit `0f8fb3d` in this branch's history (`git show 0f8fb3d:src/components/calendar/tunnel/scale.ts` …).
