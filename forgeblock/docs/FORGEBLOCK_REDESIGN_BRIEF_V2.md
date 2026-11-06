# ForgeBlock redesign, round 2

Paste this into Claude Code (VS Code), in the `forgeblock` folder, after the first redesign. Put the images from `references-v2` into `forgeblock/docs/design-refs/v2/` first.

| Reference image | What it shows |
| --- | --- |
| `old-landing-hero-PREFERRED.png` | the **old** landing hero I want back as the base |
| `current-landing-hero.png` | the current hero (centred title plus dashboard window); keep only its moving signature-line background |
| `current-result-page.png` | the current result page (too cramped) |
| `current-roles-cards.png` | the role cards (keep, but make them livelier) |
| `current-privacy-cta-footer-REDO.png` | the privacy cards, closing banner and footer: redo completely |
| `current-signin-REDO.png` | the sign-in page: too plain, redo |
| `video-reference-frames.png` | frames from a reference video (read left to right, top to bottom), described in section 3 |

## Ground rules (same as before)

- **Change the look only.** Keep every page, route, role, label, API call and access rule, and don't touch the backend.
- **Keep the brand:**
  - brand blue `#0F6CBD`
  - DM Sans and lucide icons
  - role colours (Examiner blue, Admin indigo, Client teal)
  - no profile photos, initials only
- **Every animation must be smooth and subtle**, and run only on `transform` / `opacity`. Pause loops when they are off-screen (`IntersectionObserver`), and turn them off with `prefers-reduced-motion`. You may add the `motion` (Framer Motion) package if scroll animations need it.
- **Finish with:** `npm run build` and `npm run lint` passing. Check desktop and phone widths.

## 1. Overall style: "modern Microsoft"

I like the current overall look, but I want a modern Microsoft (Fluent 2 / Teams / Outlook) feel:
- **Surfaces:** neutral light grey app background, white cards, 8–12 px radius, soft two-layer shadows.
- **Header bars:** a subtle translucent "acrylic" blur on the top bar.
- **Navigation:**
  - The active item gets a small vertical accent pill on its left plus a light tinted background.
  - On hover, items get a neutral grey background.
  - The focus ring is clear and visible.
- **Type and colour:** compact, crisp typography with clear hierarchy. Use colour only for meaning (results, roles, actions).

## 2. Workspaces: sidebar

The sidebar takes too much space.
1. **Default to a collapsed icon rail** (about 64–72 px wide) showing only the icons.
2. **Hover or expand:**
   - Hovering the rail, or clicking the expand button, opens it to full width with labels, sliding over the content.
   - A pin button keeps it open.
   - Remember the choice in `localStorage`.
3. **Icon hover effect:**
   - a rounded highlight tile fades in behind the icon
   - the icon scales up slightly (about 1.08)
   - a tooltip with the label appears
   - the active item keeps the accent pill
4. **Phones:** keep the slide-in drawer.

## 3. Landing page

### Hero
- **Base:** go back to the **old hero** (`old-landing-hero-PREFERRED.png`). Cursive "ForgeBlock" title on the left, headline, text and buttons below it, and the result card on the right.
- **Keep removed:** the small "Siamese-based bimodal signature screening" pill.
- **Background:**
  - a soft light-blue to white gradient
  - the faint moving signature lines from the current version
  - a few blurred colour blobs (blue, teal, indigo) drifting slowly
- **The right side becomes a small looping scene, instead of a static card.** Loop it every 8–10 seconds:
  1. A paper document (a form with a signature line) slides in.
  2. A signature draws itself on the line.
  3. A scanning line passes over it.
  4. The result card pops up: "Consistent", the confidence bar fills to 82%, and Cosine / Euclidean / Manhattan show "Pass" one by one.
  5. A "Sealed in ledger block #1249" chip slides in with a check.
  6. The scene fades and starts again.

### Scroll story (like the reference video)
The video shows this sequence:
- a product window rises out of a blur under the hero title
- as you scroll, it grows and becomes sharp
- it then slides to the right while text fades in on the left
- it slides away, and a horizontal logo strip fades in
- feature cards appear one by one

Do the same, professionally, for ForgeBlock:
1. **A sticky section** of about 2–3 screen heights. The result card or document from the hero moves into the centre and **morphs into the examiner dashboard window** (the "My work" mock from the current version).
2. **As the user keeps scrolling,** the dashboard slides to the right. Three short text steps fade in on the left, one at a time:
   - "Register the client's signatures"
   - "Screen a questioned signature"
   - "The examiner decides; the ledger seals it"
   
   The dashboard highlights the matching part of the screen for each step.
3. **Ledger strip:** a horizontally scrolling, endless strip of ledger blocks. Each block is a small card with a block number, a short hash, the type (screening or decision) and a coloured top edge. Use several colours (blue, teal, indigo, green, amber). Connect the blocks with a thin line, and have a soft light pulse travel along it. The hashes are illustrative.
4. **"How it works" cards** appear one after another (staggered fade-up).

### Images: people or documents?
- **No photos of people.** Stock people photos look generic, and this system handles personal signatures.
- **Use documents with signatures instead:** a contract, a bank withdrawal slip, an ID form. Draw them as clean, lightly tilted paper cards with soft shadows and a handwritten signature in ink blue. Use them in the hero scene and in "Who uses it".

### Who uses it (role cards): keep the style, make them livelier
On hover, each card lifts as it does now, then starts a small **looping animation inside its mock screen**:
- **Examiner:** a new row slides into "Needs your decision" with an Inconclusive badge, then is marked Decided.
- **Administrator:** the bar chart bars grow and re-settle, and the "Ledger: Intact" badge pulses once.
- **Client:** a new screening row appears and its check mark draws itself.

The animation stops when the mouse leaves.

### Privacy cards, closing banner and footer: full redo
Current version: `current-privacy-cta-footer-REDO.png`.
- **Privacy:** a full-width dark navy section with the brand gradient and the faint signature lines.
  - The four points (View only, Your records only, Protected sign-in, Tamper evident) become glass cards: translucent white, a thin light border, and a gradient icon tile.
  - Each card's icon gets a small hover animation: eye blinks, lock clicks, shield check draws.
- **Closing banner:** split layout.
  - Left: "Your workspace is ready when you are." with the Sign in button.
  - Right: a mini scene of a signature drawing itself, then a block sealing with a check (looping slowly).
  - Give it more depth: layered gradient, soft glow and a light border.
- **Footer:** 3–4 columns.
  - Columns: logo with the one-line description; Product links; Privacy and Help; the study / CloudNine.
  - A bottom bar with `© 2026 CloudNine. All rights reserved.` and the disclaimer line, all in a calm grey.

## 4. Sign-in page: less plain
Current version: `current-signin-REDO.png`.
- **Left panel:** keep the blue gradient, and add depth:
  - drifting signature lines and colour blobs
  - two or three floating glass mini-cards that gently bob: a "Consistent 82%" result, a "Block #1249 sealed" chip, a document thumbnail with a signature
  - the cursive ForgeBlock title draws itself once on load
- **Right panel:**
  - a soft gradient background (not flat grey)
  - the sign-in card gets a stronger shadow and a thin top accent line
  - the Microsoft/Google buttons get hover states
  - the "Which email do I use?" box becomes three small icon rows in a lighter card

## 5. Result page: back to scrolling, but shorter
Current version: `current-result-page.png`. The two side-by-side boxes feel cramped.
1. **Go back to the original single-column, scrollable layout.**
2. **Remove the circle (ring) percentage.** Show the confidence as a large number with a slim horizontal bar, as in the hero card.
3. **Shorten the text everywhere:**
   - Captions should be one short sentence.
   - The exact-match notice should be one line: "Same file as reference #1 on file. Use a new signature to test."
   - Put "How is this calculated?" behind an info icon.
4. **Order:**
   - result header (result badge, confidence, caption, receipt)
   - signatures side by side
   - key facts (client, examiner decision, date, ledger block)
   - "Show details" (scores, handwriting features, overlay or replay, ledger proof) collapsed by default
5. **Keep the result-colour tint** (green, amber or red) on the header card only, with soft shadows.
