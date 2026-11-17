# Swipe the playlist open/closed (touch only) — design (short)

**Intent:** on a phone, open the playlist by swiping right from the left edge and
close it by swiping left. Desktop behaviour is unchanged: the album art toggles
the playlist and the backdrop closes it.

## Approaches

1. **Swipe on `touchstart`/`touchend` only (picked).** One gesture is a start
   point, an end point, a horizontal-dominance check and a distance threshold,
   then the existing `active` class is added/removed. No animation work: the
   CSS transition already slides the panel. Small, and it cannot break the
   click paths because a real swipe never produces a click.
2. Live finger-following drag (touchmove + transform on the panel). Rejected:
   needs drag state, momentum and a cancel path, and fights the existing
   `0.3s` transition.
3. A third-party gesture library. Rejected: a dependency for 20 lines.

## Behaviour

- Only when `(pointer: coarse)` matches, i.e. a touch device. A touch-screen
  laptop with a mouse does keep the desktop behaviour, and the desktop build of
  the app is byte-identical in behaviour if that media query is false.
- Opening: the touch must start within 40 px of the left edge.
- Closing: any single-finger swipe left while the playlist is open.
- A gesture counts only if it moves at least 60 px horizontally and is at least
  1.5x more horizontal than vertical, so vertical scrolling and taps still work.
- Gestures that start on a slider, a text field or the folder chip strip are
  ignored: those own their horizontal drags.

## Not in scope

Live drag feedback, swipe on the player card itself, edge-swipe to navigate
between tracks, a "swipe hint" animation.

## Constraints

No new state, no new file, no dependency. Listeners are passive.
