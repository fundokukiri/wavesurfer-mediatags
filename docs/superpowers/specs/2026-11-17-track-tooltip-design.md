# Track info popup on hover — design (short)

**Intent:** a playlist row shows a truncated title and artist (`text-overflow:
ellipsis`) and nothing else. Hovering a row should show the full information.

## Approaches

1. **One shared tooltip element, filled from the track and the row's rect
   (picked).** The rows are rebuilt on every render, so the listeners live on
   the `.tbody` container and find the row with `closest()`. One element means
   no per-row nodes and nothing to leak.
2. `title` attribute on each row. Rejected: the browser's tooltip appears after
   a delay, cannot show several fields, and cannot be styled.
3. A popup per row, toggled by CSS `:hover`. Rejected: shows the same truncated
   text or needs a fixed-size card per row, and it cannot follow the row.

## What it shows

Full title (bold), Ca sĩ, Album, Thời lượng, Nguồn (server `audio/`, a linked
folder's name, or added files), and the file name. Album comes from the tags,
so it is filled in when that parse finishes; the rest is immediate.

## Behaviour

- Mouse only (`pointerType === "mouse"`), so a tap elsewhere never leaves a
  stale card behind.
- Above the row when there is room, below it otherwise, always inside the
  window. `pointer-events: none`, so the card never steals the hover.
- Hidden when the pointer leaves the row, on any scroll, or when the sidebar
  closes. A track that is removed while its card is open just goes away with
  the row.

## Not in scope

Tapping a row on a phone (there is no hover), a pin/inspect mode, showing
embedded artwork in the card, editing anything from it.

## Constraints

One fixed element, no dependency, no state outside the hovered row reference.
