# V1 verification

Implementation date: 24 November 2026. Inputs: `Slam_Book_PRD.md`, `DESIGN(2).md`, and the requested name “Raghav’s Slambook” with a warm default introduction.

## Adversarial review — 24 November 2026

Reviewed guest submission and draft recovery, owner reads and mutations, authentication boundaries, database policies/RPCs, private media, ZIP exports, the local demo store, and animation lifecycle cleanup. The following verified failure paths were fixed:

| Priority | Failure                                                                                                                                                 | Correction                                                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | An HTTP 200 with malformed JSON or a missing save acknowledgement could be treated as a successful submission, clearing the draft.                      | Validate response content and endpoint schemas; require an explicit `submitted: true` before confirmation or draft removal.                                                                                                                                               |
| High     | A late successful response could erase another draft saved in the same browser.                                                                         | Clear only when the saved attempt ID, proof, and entry still match the submitted draft. Stop autosave synchronously when success is acknowledged. This does not turn the single browser draft into a collaborative editor.                                                |
| Medium   | Requests could leave forms busy indefinitely; custom `Headers` and tuple headers were dropped.                                                          | Add bounded requests, forward caller cancellation, clean up timers/listeners, and normalize headers through `Headers`. Submission finalization has a 70-second deadline; other JSON requests default to 30 seconds.                                                       |
| Medium   | An already-open reset confirmation remained active during submission; photo preparation could race selection or finish after unmount.                   | Guard operations synchronously, disable both reset actions while busy, prevent overlapping preparation, and revoke unattached photo previews.                                                                                                                             |
| Medium   | Export offsets could skip later entries when an earlier page was deleted. Cancelled or incomplete photo downloads were not handled fully.               | Paginate by timestamp and ID, forward request cancellation to storage, release ZIP resources, and reject photo byte counts that disagree with the manifest.                                                                                                               |
| Medium   | Failed searches could expose old results as if they matched the current query; access loss and disappearing last pages were not recovered consistently. | Cancel superseded reads, validate nested response data, clear stale results, provide retry, clear the private view on 401/403, and return to the last available page.                                                                                                     |
| Medium   | Punctuation was discarded from name searches, while quoted filter values could fail parsing.                                                            | Escape literal search patterns and quote PostgREST values. Tests execute the patterns in Postgres and verify the Supabase SDK's URL serialization. See the [PostgREST grammar](https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters). |
| Medium   | Logout ignored authentication errors and could report success while the session remained active.                                                        | Propagate sign-out failure; rejected owner logins clear their local session. Hosted auth behaviour still needs live verification.                                                                                                                                         |
| Medium   | Failed demo photo deletion lost its retry information; structurally invalid JSON could be overwritten by later writes.                                  | Persist deletion work before removing files, retry on subsequent requests, validate stored state, and preserve incompatible files. Remove temporary state files after failed writes.                                                                                      |
| Low      | Demo host validation accepted URL-shaped input, and CLI hostname overrides using `=` escaped the local-only guard.                                      | Require an exact loopback host/port and reject all hostname override forms. The `--hostname=0.0.0.0` rejection was checked without starting a server.                                                                                                                     |
| Low      | Field descriptions and the hidden photo input lacked complete accessible associations; confirmation did not move focus.                                 | Connect descriptions and labels, and focus the confirmation heading after success.                                                                                                                                                                                        |

Validation after these changes: **44 tests passed across seven test files**, `npm run check` passed, and `npm run build -- --webpack` passed. The test command now discovers all top-level `*.test.ts` files. No new package or database migration was required.

Four new browser regressions cover malformed acknowledgements, reset during submission, failed/retried owner reads and lost access, and concurrent deletion of the last page. The existing successful-submit test now also checks confirmation focus. `npm run test:e2e -- --list` registers **16 tests**; this is discovery only. Chrome cannot launch in the current sandbox, so neither those new browser cases nor a fresh visual check is represented as executed. The earlier browser results below predate this review. Hosted Supabase Auth/Storage, cron delivery, and physical mobile devices remain unverified without the corresponding environment.

## Automated checks

| Check                    | Result    | Scope                                                                                                                                                |
| ------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript               | Passed    | Strict type checking of the app and tests                                                                                                            |
| Production build         | Passed    | Next.js server routes, public and owner pages                                                                                                        |
| Postgres tests           | 13 passed | Actual migrations on PGlite; RLS, owner/non-owner access, idempotency, closed/expired attempts, media validation gates, deletion, limits and cleanup |
| Schema tests             | 6 passed  | Input bounds/identity plus validated owner response shapes and timestamps                                                                            |
| Image and export tests   | 7 passed  | Image decoding, ZIP integrity, missing/truncated photos, cancellation and pagination during deletion                                                 |
| Browser API unit tests   | 6 passed  | Invalid JSON/acknowledgements, header preservation, HTTP errors, timeouts and caller cancellation                                                    |
| Draft unit tests         | 4 passed  | Clear only the acknowledged draft; preserve newer attempts/text and unreadable data                                                                  |
| Search tests             | 2 passed  | Literal punctuation/wildcards in Postgres and quoted SDK filter/cursor serialization                                                                 |
| Chromium browser tests   | Not rerun | 12 passed before this review; 16 currently registered                                                                                                |
| Local demo store tests   | 6 passed  | Development-only access, persistence, idempotency, photos, incompatible state and durable deletion retries                                           |
| Local demo browser tests | Not rerun | 4 passed before this review; real local submission/export/deletion and idle-page stability                                                           |

The main browser suite simulates a failed final submission, retries with the same attempt ID, reuses an uploaded photo, and confirms that the draft clears only on success. Its owner data and guest storage/submission responses are test fixtures. The separate, explicitly enabled local demo seeds six fictional entries into `.local-demo/` and saves test entries and photos there. Production never enables this demo or its owner sign-in bypass. Neither mode shows submitted entries on the public homepage.

Before this review, the local demo was exercised at `http://localhost:6001` without Supabase or sign-in, including a real browser photo upload, export inspection, and deletion of the test entry. The anonymous API denial check was also rerun with demo mode off and passed, including a 404 for the local-only upload route. The initial 25 database/schema/media/demo tests passed; the expanded suite now has 44 passing cases. The demo starts with six sample entries and submissions open.

Setting `devIndicators: false` triggered repeated Turbopack chunk-list restart messages in this installed version. Restoring the default stopped the loop. A browser regression check observes the idle homepage for 12 seconds, then an in-progress form for 15 seconds: no automatic requests to reload either page, and the form retains its answer, current step, and keyboard focus. The test waits for the chapter heading’s intentional focus transition before typing.

## Responsive and visual review

The typography revision consolidates the global stylesheet to four font-size tokens (14/16/24/36px at the default root size), two weights, and one family. The cover retains a separate responsive display treatment. Updated desktop and 390px form/cover screenshots were visually reviewed. A 320px screenshot with 200% text and expanded spacing exposed header overflow and a partially visible off-screen skip link; the header now wraps and the skip link hides by its own height. Actions and draft controls can wrap, and numbered markers scale with their text. The sandbox blocks Chrome startup and escalation for the final rerun, so these last enlarged-text corrections have not been visually reconfirmed. The prior responsive results below predate this typography revision.

Strict type checking and a production build using `npm run build -- --webpack` passed after the typography changes. The first chapter’s introduction was subsequently shortened to “Let’s start at the beginning.”

The later copy pass replaced couple-oriented phrases in questions, chapter labels, photo headings, metadata, the cover tagline, confirmation text, and owner views. Existing answer keys, stored entries, and custom owner notes are unchanged. Existing browser test locators now use the revised question labels.

Chapter cards retain the original pink, yellow, violet, and mint families with slightly lighter solid bases. Their mesh gradients have been removed. Card grain opacity is 0.16, with an opaque base inside the effect so grain blends against the card colour. `node scripts/check-contrast.mjs` reads the CSS and calculates conservative contrast floors over the solid base and the darkest possible grain.

The supplied React Bits Aurora component now renders the page backgrounds with native WebGL 2: a violet/pink/peach effect at the bottom of the cover and a milder lilac/pink effect at the bottom of the form document. Both use upward direction, one layer, no cursor interaction, and a 1.5 device-pixel ratio. Light mode is disabled to preserve the supplied pastel colours' lightness instead of clamping it to 0.7. Maximum edge blending, broader glow, lower amplitude, and an additional CSS fade soften the boundary. The component has a CSS fallback for unavailable or lost WebGL contexts, context recovery, off-screen/hidden-tab suspension, and live reduced-motion handling that stops scheduling animation frames. No runtime dependency was added. The cover tagline and form supporting text have darker muted colours to retain readability over the new background.

TypeScript and the production webpack build passed after the Aurora integration. The actual vertex and fragment shaders also compiled, linked, and rendered successfully in an offline OpenGL ES 3 context at desktop and mobile sizes, at two animation times. Composited previews of those shader frames were visually reviewed for colour and edge softness. This verifies the shader and its configured colours, not the React lifecycle or browser layout; Chrome remains blocked by the sandbox.

Animated grain is confined to the aurora backgrounds and chapter cards, behind the content. Cover grain opacity is 0.24 and the bottom-of-form grain is 0.20, with a 220px texture tile and a 600ms animation cycle for slightly coarser, faster noise. Cards retain their subtler 0.16 grain, 180px tile, and 800ms cycle. The translated texture is clipped inside each effect, does not intercept pointer input, and stops when reduced motion is requested. There is no page-wide foreground noise overlay.

| Chapter palette | Contrast floor against #111111 | 14px label / 16px body | 36px heading |
| --------------- | ------------------------------ | ---------------------- | ------------ |
| Pink            | 14.78:1                        | Pass                   | Pass         |
| Yellow          | 16.41:1                        | Pass                   | Pass         |
| Violet          | 14.71:1                        | Pass                   | Pass         |
| Mint            | 14.68:1                        | Pass                   | Pass         |

The checks use [WCAG's sRGB luminance and contrast formula](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) with AA thresholds of 4.5:1 for normal text and 3:1 for large text, plus the [W3C soft-light blend formula](https://www.w3.org/TR/compositing-1/#blendingsoftlight). The bounds take each solid background's RGB channels, apply full-black grain at its CSS opacity, and round channels downward before measuring. These are CSS/compositing calculations for the chapter cards, not a fresh browser capture or a whole-site WCAG audit; Chrome remains unavailable in the current sandbox.

The revised single-screen cover was checked at 320 × 568, 390 × 844, 844 × 390, and 1440 × 900: document dimensions matched the viewport, with no vertical or horizontal page overflow. The shared aurora animates on both routes and stops with reduced motion enabled. The form uses the softer background only along the bottom of the page. Redundant sidebar quotations, repeated required-answer instructions, and the form’s decorative footer were removed; draft saving and reset controls remain.

Welcome, questionnaire, preview, confirmation, login, owner collection, and owner entry screens were checked at **320, 375, 390, 768, and 1440 CSS pixels** in desktop Chromium. No horizontal document overflow was detected. Mobile form and desktop welcome/owner screenshots were visually reviewed. Labels, required-field errors, draft status, photo format guidance, and privacy copy are visible. Primary controls are at least 44 × 44 pixels; input text is at least 16 pixels. The form uses normal document scrolling so sticky bottom controls do not obstruct the on-screen keyboard. Focus outlines, a skip link, reduced-motion styles, and labelled controls are included.

Generated visual artifacts:

- `artifacts/home-390.png`, `artifacts/home-1440.png`
- `artifacts/form-390.png`, `artifacts/form-1440.png`
- `artifacts/owner-390.png`, `artifacts/owner-1440.png`
- `artifacts/cover-320.png`, `artifacts/cover-390.png`, `artifacts/cover-844.png`, `artifacts/cover-1440.png`
- `artifacts/form-simplified-390.png`, `artifacts/form-footer-1440.png`
- `artifacts/form-enlarged-320.png`, `artifacts/form-enlarged-390.png` (diagnostic captures before the final enlarged-text fixes)

Owner screenshots contain explicitly mocked test entries. The real homepage contains no submitted content.

## Environment-dependent verification still required

No live Supabase project credentials or Vercel deployment were supplied. The following are not represented as completed:

1. Apply the migrations to the chosen Supabase project and verify its existing policies do not grant broader table or bucket access.
2. Use the real owner account to sign in, read/search/export/delete an entry, and close/reopen submissions. Verify a second, non-owner account is rejected by application APIs and direct Supabase reads.
3. Submit real photos through signed upload URLs, retry an interrupted upload, and confirm the private storage object is deleted with its entry. Open the owner photo URL in a signed-out browser and confirm denial.
4. Trigger the authenticated cleanup endpoint and verify abandoned objects and failed-deletion markers are removed. Confirm Vercel’s deployed cron invokes it successfully.
5. Complete the shared-link flow on a physical **iPhone with Safari** and **Android phone with Chrome**, including gallery selection, orientation, on-screen keyboard, slow/disconnected network, refresh, preview, and confirmation. Resized desktop Chromium is not a substitute for these device tests.
6. Review live storage/database/transfer quotas, hosting timeouts, and the current production origin configuration before sharing the link.

The V2 curated showcase, contributor permission collection for public featuring, and public media access remain outside V1.
