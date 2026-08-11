# Word add-in assistant scroll-jump report

Date: 2026-08-11

Scope: the assistant pane in `word-addin`, specifically the latest user-turn pinning behavior and the transition from an open activity card (`Working`) to a collapsed `Completed in N steps` card.

## Intended behavior (source of truth)

The interaction contract is:

1. When Send is accepted, the newly submitted **user message becomes the anchor**.
2. The top of that user-message row settles at the transcript's existing **80 px top-padding line**. The important invariant is a consistent, nonzero top gap; 80 px is the preferred current value because it clears the floating header/scrim.
3. The assistant status, activity card, prose, and edit UI render **below the anchored user message** in normal document flow.
4. Once the pin has settled, response growth or contraction must not move the anchored user message. This includes `Working` becoming `Completed in N steps`, automatic activity-card collapse, Markdown growth, edit cards, errors, and completion indicators.
5. Show the down-arrow only when there is **real content overflow below the current viewport**. Reserved blank spacer used to make pinning possible must not, by itself, make the arrow appear.
6. Clicking the arrow cancels any pin animation and **jumps immediately to the current true bottom**; it must not perform a 450 ms smooth animation.
7. Clicking the arrow while a response is still streaming jumps to the bottom that exists at that instant. Later response growth does not silently drag the user; if new overflow appears, the arrow appears again.
8. Manual scrolling wins. Wheel, touch, scrollbar drag, and keyboard scrolling cancel pending programmatic pin motion and the application must not repin until the next explicit Send.

The pin position should be a named layout value such as `PIN_TOP_GAP_PX = 80`, preferably shared with the transcript's `pt-20` and header/safe-area layout. It should not vary with response height.

### Expected states

| State | Anchored user row | Response | Down-arrow |
| --- | --- | --- | --- |
| Immediately after Send | Moves once to the 80 px pin line | Empty/loading row below | Hidden unless real content already extends below viewport |
| `Working` | Fixed at pin line | Open activity below | Visible only for real overflow |
| `Completed in N steps` | Unchanged | Collapsed activity below | Recomputed without scrolling |
| Long streamed answer | Unchanged | Grows below | Appears when answer exceeds available space |
| Arrow clicked | No longer the active viewport anchor | View jumps to exact bottom | Hidden immediately; may return if more content arrives |
| User manually scrolls | No forced correction | Continues streaming in place | Reflects distance from bottom |

## Executive summary

This is a client-side layout/scroll race, not a backend latency problem.

The pane performs three independent asynchronous operations after Send:

1. it appends the user row and an initially empty assistant row;
2. it measures and adds a large `min-height` spacer to the assistant row;
3. it starts a native smooth scroll to the latest user row.

The activity UI then changes size when reasoning/document activity becomes `Completed in 1 step`. Because the spacer is installed after paint and the native scroll was calculated while the scroll range was still changing, the browser/WebView can finish at a different scroll position. The user row therefore stops being pinned even though the original target was correct.

There is also a target-calculation mismatch. The current worktree requests a 24 px pin target, but its spacer uses the first message's 80 px top padding as the amount of space to preserve. A short response can therefore settle near the intended 80 px line while a response tall enough to create additional scroll range can climb to 24 px. The target and spacer must both use the same 80 px pin line.

The sluggishness has two parts: the visible scroll uses an implementation-dependent native smooth duration, and each streamed event causes the whole chat view to render again while also removing/re-adding the scroll listener. Rendering additionally repeats redline projection and Markdown work over the growing response.

The current uncommitted implementation replaces native smooth scrolling with a deterministic animation, but sets it to 450 ms for both pinning and the arrow. The deterministic timing removes one source of cross-WebView variance, but 450 ms remains visibly slow and the arrow behavior directly contradicts the immediate-jump requirement.

Confidence in the primary scroll diagnosis: high. Confidence in the relative contribution of each rendering cost: medium until an Office WebView performance trace is captured.

## What happens in the code

### Send and stream lifecycle

`useWordAssistantChat.ts` marks the response as loading and appends both the user row and an empty assistant row in one React update. It then waits two animation frames and invokes `onTurnReady`. Every reasoning, document-read, or content event creates another `messages` update.

Relevant locations:

- `word-addin/src/taskpane/hooks/useWordAssistantChat.ts`: appends the empty assistant row and invokes `onTurnReady` after two animation frames.
- `word-addin/src/taskpane/hooks/useWordAssistantChat.ts`: `publishAssistantEvents` maps the messages array and publishes every stream event.

### Pinning and reserved space

In the committed implementation (`HEAD`), `ChatView.tsx` calculates the assistant `min-height` in a normal `useEffect`. A normal effect runs after the browser has already painted. The first visible layout can consequently have an assistant height of zero, followed by a second layout with the reserved spacer.

The pin is a separate native call:

```ts
container.scrollTo({
    top: element.offsetTop - 24,
    behavior: "smooth",
});
```

That call is delayed by animation frames, but it is not synchronized with the spacer update or later activity-card height changes. A smooth-scroll implementation may clamp its destination to the scroll range that exists when the animation begins. Adding the spacer or activity content changes that range while the animation is active.

The transcript explicitly disables browser scroll anchoring with `[overflow-anchor:none]`, so the browser will not compensate for these programmatic layout changes. That is appropriate for a managed chat viewport, but it means the application must own the position consistently.

### `Completed in 1 step` transition

`PreResponseWrapper.tsx` changes its label from `Working` to `Completed in N steps` and collapses its children from a `useEffect`. This is another post-paint state update. The completion card is therefore the moment at which the race becomes visible, but it is not itself calling `scrollTo`.

The modal/card is the trigger; the actual defect is the unstable geometry and competing timing in `ChatView`.

## Root causes

### P0 — the spacer and scroll target use different pin lines

The current worktree reserves enough space for the latest user row to settle at the first row's 80 px top offset, then asks the scroll animation to move that row to 24 px. When the assistant is short, the browser cannot reach 24 px and clamps at roughly 80 px. When assistant content grows, the extra scroll range makes 24 px reachable, so the user row moves upward. Response length is therefore changing the final anchor.

Both calculations must use one shared 80 px pin line. Ignoring zero-height sentinel details, the reservation is conceptually:

```ts
assistantMinHeight = Math.max(
    0,
    container.clientHeight
        - PIN_TOP_GAP_PX
        - latestUser.offsetHeight
        - interRowGaps
        - transcriptBottomPadding,
);
```

The requested scroll destination is `latestUser.offsetTop - PIN_TOP_GAP_PX`. With the same value in both equations, a short response is exactly scrollable to the anchor and a long response grows below it without changing it.

### P0 — spacer is committed after paint

The assistant row is first rendered without its final reserved height. Measuring it in `useEffect` guarantees at least one paint can occur with incomplete geometry. The later `min-height` update changes `scrollHeight` underneath a pending smooth scroll.

### P0 — native smooth scrolling owns timing while content is changing

The WebView controls native smooth-scroll duration, clamping, and retargeting. Those semantics are not consistent across Chromium and Office's macOS WKWebView. There is no cancellation on a new session or on direct wheel/touch interaction in the committed code.

### P1 — the user bubble can change height after the pin measurement

In the committed `UserMessage.tsx`, long content is clamped only after a `ResizeObserver` measurement sets `canExpand`. The pin/spacer can be calculated using the uncollapsed height and then invalidated when the message becomes collapsible.

### P1 — streaming causes avoidable React and DOM work

- `publishAssistantEvents` calls `setMessages` for every event/chunk.
- `ChatView` maps the complete conversation on every update.
- Its scroll-listener effect depends on the entire `messages` array, so the listener is removed, added, and measured on every streamed update.
- `AssistantMessage` repeatedly projects the growing redline stream and rerenders Markdown.
- Glass surfaces use `backdrop-blur-2xl`; this may magnify paint cost in an Office WebView, although it should be confirmed with a trace before changing the design.

This work competes with scrolling and makes a timing defect feel much slower.

## Race-condition audit

| Race | Failure mode | Required guard |
| --- | --- | --- |
| User/assistant rows commit vs spacer measurement | First frame has no reservation; later `min-height` changes the scroll range | Install spacer in `useLayoutEffect` before paint and before pinning |
| Spacer update vs pin animation start | Destination is clamped against stale `scrollHeight` | Start one pin only after the spacer DOM write is complete |
| Four queued animation frames (`useWordAssistantChat` plus `ChatView`) vs first stream event | `Working` or content can land before the pin calculates its destination | Have one owner schedule the layout transaction; pass the expected turn ID |
| `Working` children collapse from `PreResponseWrapper` effect | Post-paint height contraction can expose a stale position or stale arrow | Freeze the assistant row's reserved minimum and recompute arrow state without scrolling |
| `isResponseLoading=false` vs final event completion | Label, activity collapse, completion icon, and final content may commit in separate frames | Treat terminal updates as geometry-only changes; none may call or retarget pinning |
| Temporary assistant ID replaced by server ID | React key can remount the assistant row and reset local open/minimized state | Keep a stable client render key for the turn or migrate the key only before activity begins |
| Long user message overflow measurement | Bubble clamps after the spacer used its uncollapsed height | Apply the max-height on the first render; measure only whether controls are needed |
| Pane width/height resize vs pinned geometry | Text rewrap changes `offsetTop`/height; plain spacer update lets the anchor drift | Preserve the anchor's viewport `y` while recomputing, unless the user has manually scrolled |
| Composer height change vs hard-coded bottom padding | Attachments/errors can cover response content and corrupt bottom detection | Derive transcript bottom padding and arrow position from the measured composer height |
| Stream DOM growth vs arrow visibility | Local child state or font/layout changes may not emit a container scroll event | Observe the response/end sentinel size and update arrow state once per frame |
| Stream update vs scroll-listener effect | Listener is removed/re-added for every `messages` identity | Bind once for the container lifetime |
| Pin animation vs arrow click | Old animation can continue after the requested bottom jump | Cancel pin first, then set exact bottom synchronously |
| Pin animation vs manual input | Wheel/touch cancellation misses keyboard, scrollbar dragging, and pointer input | Cancel on all user scroll modalities and ignore the animation's own scroll events |
| Session/history switch vs queued frame/timer | Stale callback scrolls the newly mounted chat | Invalidate in a layout-phase cleanup and verify session ID, turn ID, and target element before every write |
| New chat/unmount vs animation | Orphaned requestAnimationFrame writes to detached/stale state | Cancel frame, observers, timers, and listeners on cleanup |
| Rapid double submit | Two turn IDs compete for the anchor | Keep submit lock and make layout ownership idempotent per accepted user-turn ID |
| Arrow click vs continued streaming | User reaches the current bottom, then new content appears | Do not auto-follow; show the arrow again when new real overflow exceeds the threshold |
| Fractional layout pixels/elastic overscroll | Arrow flickers around zero or negative distances | Clamp values and use a small 2–4 px bottom epsilon with hysteresis |

The server cannot cause the scroll directly. It can only alter the timing and size of client renders, which makes these races more or less likely.

## Edge-case behavior

### First turn and short responses

The first user turn must still move to the 80 px anchor even when the response is empty or one line long. The artificial assistant minimum provides exactly enough scroll range to do that. Because the viewport is then at its current maximum, the spacer alone produces no bottom distance and the arrow stays hidden.

### Long and rapidly streamed responses

The user row stays at 80 px. Content initially consumes the reserved assistant minimum without increasing total height. Once real response height exceeds that minimum, it extends the scroll range below the viewport and the arrow appears. Chunk cadence must not affect either position.

### Long user messages

The message is clamped from its first painted frame. Expanding or collapsing it later must keep its top at the current viewport position; only content below it and arrow visibility change. If the collapsed bubble itself is taller than the usable viewport, pin its top at 80 px and allow the rest to overflow normally.

### User-controlled activity cards and edit UI

Opening `Completed in N steps`, expanding reasoning, expanding edit summaries, accepting/rejecting edits, and showing an error may change response height. They must never repin the user row. They only update whether real content exists below the viewport.

### Cancel, error, and empty terminal response

Canceling or failing a response leaves whatever assistant content exists below the pinned user row. An empty terminal/error row must not remove the reservation in a way that moves the user row. No completion path should invoke a second scroll.

### Resize, zoom, fonts, and host chrome

Pane resize, browser zoom, font loading, and Office host/header changes can rewrap messages. If the user has not manually scrolled since Send, preserve the anchored row at the 80 px line while recalculating the spacer. If the user has taken control, preserve their viewport instead. The layout must use the measured composer obstruction rather than the current fixed 160 px bottom padding.

### History restore and section switching

Opening stored history is not a new Send. Position it once behind the opacity gate (latest turn at the same 80 px line is acceptable), then reveal it. Switching chats or sections invalidates all pending pin work from the old session. Returning to a live chat should restore its actual saved viewport rather than replaying the send animation.

### Accessibility and input methods

Respect `prefers-reduced-motion` by pinning instantly. Keyboard scrolling, scrollbar dragging, wheel, and touch all count as manual control. The arrow remains a keyboard-accessible button, announces “Scroll to bottom,” and performs the same immediate jump for pointer and keyboard activation.

## Recommended fix

### 1. Make one turn-layout transaction

When a new user turn is accepted:

- render the empty assistant row;
- in `useLayoutEffect`, measure and install its spacer before paint;
- clamp a long user message from its first render;
- start exactly one pin operation for that user-message ID after the final geometry exists.

The spacer should remain frozen while the answer streams. Recalculate it only when the pane dimensions or pinned user-row dimensions genuinely change.

### 2. Use one deterministic pin motion and an instant arrow jump

Do not rely on `behavior: "smooth"` inside Office. Either pin instantly or run a controlled requestAnimationFrame animation with:

- a fixed destination clamped once after spacer installation;
- a short duration (roughly 180–250 ms; 0 ms for reduced motion);
- cancellation on wheel, touch, session change, unmount, and a new pin request.

Do not update or extend the destination when `Working`, `Completed`, or response content changes.

The arrow is separate from pin motion. Its handler should cancel the pin and synchronously set `scrollTop` to `scrollHeight - clientHeight` (clamped to zero). It should not call the animation helper.

### 3. Separate live sends from restored-history positioning

Restored history may be opacity-masked and positioned once before reveal. It should not share mutable flags or timers with a live send. Key both paths by session and user-turn ID so a stream update cannot rerun history positioning.

### 4. Remove avoidable streaming overhead

- Attach the scroll listener once, not once per `messages` update.
- Throttle scroll-button measurement to one requestAnimationFrame and only set state when the boolean changes.
- Coalesce SSE publications to at most one React update per animation frame.
- Memoize historical message rows so only the live assistant row rerenders.
- Profile redline projection/Markdown parsing; if they dominate, perform the incremental projection once in the chat hook or defer expensive parsing until a frame boundary.
- Profile backdrop blur in the real Office WebView before reducing it.

## Required regression test

The existing layout test verifies that a growing content-only response retains its early pinned position, but it currently encodes the old 24 px target for one turn. It must be updated to assert the 80 px contract for short and long responses. It also does not cover the reported completion transition.

Add a paced stream test with this exact sequence:

1. create enough history to make the transcript scrollable;
2. submit a second user message;
3. emit one reasoning or document-read event and wait for `Working`;
4. capture both the user row's viewport `y` and the container's `scrollTop`;
5. finish that event and emit content so the card becomes `Completed in 1 step` and collapses;
6. wait beyond the maximum pin-animation duration;
7. assert the row is at `containerTop + 80 px` and that both measurements changed by no more than 2–4 px;
8. repeat with a long, initially collapsible user message;
9. repeat with an empty/one-line response to prove short and long answers use the same pin line;
10. assert wheel, touch, keyboard scroll, and scrollbar/pointer interaction cancel the animation.

Add a separate arrow test:

1. pin a turn at 80 px and stream until real content overflows;
2. assert the arrow is absent before real overflow and appears afterward;
3. click it and assert the container reaches `scrollHeight - clientHeight` in the same task/next animation frame, with no intermediate animation;
4. assert the arrow disappears at the bottom;
5. append more streamed content and assert the viewport is not auto-followed and the arrow returns;
6. click while pin motion is active and prove the canceled pin cannot pull the viewport away from the bottom later.

Add resize/session tests that preserve the 80 px anchor when the pane rewraps, preserve manual scroll after user intervention, and prove a queued callback from chat A cannot move chat B.

Run the test in Chromium for CI and do one smoke test in the actual Word task pane/WKWebView. Chromium alone cannot validate the original native-smooth-scroll behavior.

## Current worktree status

There are already uncommitted edits in:

- `word-addin/src/taskpane/components/assistant/ChatView.tsx`
- `word-addin/src/taskpane/components/assistant/UserMessage.tsx`

Those edits implement much of the correctness strategy above: pre-paint spacer installation, one pin request per turn, controlled scrolling/cancellation, frozen stream geometry, and first-paint user-message clamping. They were treated as user-owned and were not modified during this investigation.

Validation performed against that current worktree:

- `npm run typecheck`: passed.
- `npx playwright test e2e/chat-layout.spec.ts --project=chromium --reporter=line`: passed (1 test, 12.9 s).
- `git diff --check`: passed.

This is encouraging but not sufficient to declare the reported issue fixed: the current code/test still mix 80 px and 24 px targets, there is no exact `Working` to `Completed in 1 step` position-invariance test, the arrow uses the same 450 ms animation as pinning, the scroll listener still depends on `messages`, and the run did not exercise the real Office WebView.

## Acceptance criteria

- The latest user row settles at `containerTop + 80 px` (±4 px) for empty, short, and long responses.
- The same row remains within 4 px of that position from Send through completion, unless the user manually scrolls or clicks the arrow.
- `Working` to `Completed in N steps` produces no programmatic change in `scrollTop` after the pin completes.
- Pin motion finishes in 250 ms or less, or is instant when reduced motion is requested.
- The arrow is hidden when only the spacer fills the viewport, appears for real overflow, and reaches the exact current bottom immediately when activated.
- New content after an arrow jump does not auto-follow; the arrow returns when overflow returns.
- Wheel, touch, keyboard, and scrollbar/pointer input immediately cancel programmatic pin motion.
- Resize preserves the 80 px anchor only while programmatic anchoring is active; it preserves manual position after the user takes control.
- Completion, cancellation, errors, activity toggles, edit-state changes, and server-ID replacement never initiate a second pin.
- Stream updates do not rebind the scroll listener.
- The exact regression passes in CI and is smoke-tested in Word on macOS.
