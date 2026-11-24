# Personal Slam Book — PRD

Status: V1 implementation brief, with V2 roadmap. Updated 24 November 2026.

## 1. Goal
Build a small, explicitly mobile-first personal slam book where friends answer questions, share memories, and upload photos. Phones are the primary design and implementation target; progressively enhance the experience for tablets and desktops. The owner shares one URL through WhatsApp or other channels. Completing an entry should take approximately 5–10 minutes.

## 2. Scope
### V1: Collect and privately browse entries
- One owner and one slam book.
- Public submission form accessible through one shared link.
- No invitation tokens, guest accounts, or sign-in required to submit.
- Only the authenticated owner can read submitted entries and photos.
- Owner can search entries, open individual entries, delete entries, export them, and close submissions.
- Repeat submissions are allowed; names do not have to be unique. Prevent accidental duplicate requests, not multiple deliberate entries by the same person.

### V2: Curated homepage showcase — do not implement in V1
- Turn the homepage into a showcase of entries manually selected by the owner.
- Keep a prominent “Sign my slam book” action linking to the submission form.
- Owner can preview, publish, unpublish, and reorder selected entries.
- Owner can choose the answers and photos shown for each featured entry.
- Unselected entries and fields remain private. Contact details must never appear automatically.
- No automatic publishing on submission. Removing an entry from the showcase removes its public access, including associated showcased media.
- Before publishing, obtain the contributor’s permission. Existing V1 submissions are not automatically eligible for public display.
- Final visual layout and publication controls are deferred to V2.

## 3. V1 user journey and routes
1. `/`: Welcome page with personal introduction and a “Sign my slam book” button. No submitted entries appear here in V1.
2. `/sign`: Friend fills in questions, optionally adds photos, and previews their entry.
3. Submission succeeds: show confirmation and clear the saved local draft.
4. `/admin`: Owner signs in and browses/searches entries.
5. `/admin/entries/[id]`: Owner reads an entry with its photos and can delete it.

Keep the form on `/sign` from the start so a future homepage showcase does not break the shared form link. No public entry-detail routes in V1.

## 4. Questionnaire
Use a fixed question set with stable field keys; no questionnaire builder.

| Field | Requirement |
| --- | --- |
| Name | Required |
| Nickname | Optional |
| How/where we met | Required |
| What do you remember about when we first met? | Optional |
| Favourite memory together | Required |
| Three words to describe yourself right now. | Optional |
| A funny incident or inside joke | Optional |
| A song that reminds you of us | Optional |
| A message for future us. | Optional |
| Photos together | Optional; maximum 3 |
| Photo captions | Optional |
| Instagram/contact handle | Optional; private |

Suggested limits: name/nickname 100 characters, long answers 2,000 characters, captions 250 characters. Show required fields and validation messages clearly.

## 5. Design — pending a separate Markdown brief
- Visual direction is intentionally open. The owner will supply a separate design Markdown file later, based on a design SOP Markdown file. Read those supplied documents before finalising the UI.
- The forthcoming design brief and its referenced SOP govern visual style, layout, typography, colours, spacing, components, imagery, and motion for both V1 and the future V2 showcase. No scrapbook aesthetic, palette, font, or component library is prescribed by this PRD.
- This PRD defines product scope, behaviour, privacy, and technical requirements. Apply the design documents within those constraints; flag any functional conflicts rather than silently changing scope.
- Until the design documents arrive, backend and functional scaffolding may proceed with a neutral, temporary UI. Do not treat placeholder styling as the approved design or invent the missing design SOP.
- Keep styling easy to revise through reusable components and centralised design tokens. Final visual acceptance depends on the supplied design documents.
- Mobile-first is a mandatory product requirement for all screens, including owner/admin screens and the future V2 showcase. Design the phone experience first, then enhance it for larger screens. The forthcoming design brief and SOP must preserve this requirement.
- Use a single-column form on phones, readable text, and no horizontal page scrolling at widths of 320 CSS pixels and above. Use mobile base styles with progressive enhancements at wider breakpoints.
- Make primary controls comfortable to tap, with touch targets at least 44 × 44 CSS pixels. Use form input text of at least 16 CSS pixels and appropriate mobile keyboard/input types. Do not rely on hover interactions.
- Ensure the on-screen keyboard, device safe areas, and any sticky controls do not hide focused fields, validation messages, or submission actions. Support photo selection from a phone gallery.
- Keep initial loading lightweight, load photos only when needed, and retain upload progress/retry behaviour on slower mobile connections.
- Comfortable touch targets, accessible labels, visible focus states, and reduced-motion support.
- Progress indicator, preview before submission, and clear loading/error/empty states.
- Save text draft progress locally in the browser; explain that photos may need to be selected again after refresh. Clear drafts after successful submission and provide a reset action.

## 6. Stack
- Next.js and TypeScript on Vercel for the frontend and server routes.
- Supabase Postgres for structured records, Supabase Auth for owner login, and a private Supabase Storage bucket for photos.
- Store media paths and metadata in Postgres, never image blobs or base64 payloads.
- Server validates guest submissions and grants narrowly scoped upload authorisation. Upload files directly to Storage rather than routing image bytes through Vercel.
- Keep privileged Supabase keys server-side. Restrict owner operations to the configured owner identity, not merely any authenticated account.

## 7. Minimal data model
- `entries`: UUID, name, nickname, answers JSON, questionnaire_version, contact_handle, unique submission_request_id, created_at.
- `entry_media`: UUID, entry_id, storage_path, caption, size_bytes, mime_type, sort_order, created_at.
- `settings`: singleton record with submissions_open and welcome text.
- Supabase Auth contains the owner identity; no guest user records or invitations table.

Use migrations and row-level security for every application table. Public clients must not be able to list/read entries or media. Guest writes go through validated server endpoints. Do not add public read policies for the future showcase in V1; implement its explicit published-content model in V2.

## 8. Media and abuse controls
- Photos only; no video or audio in V1.
- Accept JPEG, PNG, and WebP; show a clear message for unsupported formats.
- Resize/compress in the browser, targeting approximately 500 KB per image; enforce a hard 2 MB uploaded-file limit and maximum 3 images per entry.
- Enforce file type, size, count, and ownership/path restrictions outside the UI. Do not trust client-provided storage paths.
- Show upload progress and retry failures without clearing answers.
- Use persistent rate limiting for submission and upload-authorisation endpoints; do not rely on per-process memory in serverless functions. CAPTCHA can be added if abuse occurs.
- Use a per-attempt idempotency identifier so repeated taps or retries do not create duplicate records.
- Finalise entries only after validating associated uploads. Clean up abandoned uploads and delete photos when their entry is deleted.
- Closing submissions must reject new submissions and upload authorisations server-side.

## 9. Privacy and exports
- Explain before submission: responses and photos are visible only to the owner in V1.
- A forwarded link can be used by anyone; no verified identity or one-person-one-entry guarantee.
- Owner can export answers and photos with a manifest connecting them. Export actions require owner authorisation.
- Future showcasing requires a separate publication decision and contributor permission; do not promise permanent privacy if later asking to feature an entry.

## 10. Capacity assumptions
Design for roughly 100 friends initially. At 3 photos per person averaging 500 KB, photo storage is approximately 150 MB. Allow headroom for temporary uploads and exports. Supabase Free was checked during planning: 500 MB database and a separate 1 GB file storage allowance; verify current quotas before deployment. Monitor transfer usage as well as stored bytes. Free projects can pause after inactivity, so this should not be treated as a permanent archive without exports.

Pricing reference: https://supabase.com/pricing

## 11. Acceptance criteria
- A friend can submit from a phone using the shared link without authentication.
- Verify welcome, form, preview, confirmation, and owner screens at 320, 375, and 390 CSS-pixel widths, plus tablet and desktop widths. No horizontal page scrolling, clipped content, or overlapping controls.
- Verify the complete submission flow in iOS Safari and Android Chrome, including gallery uploads, keyboard interaction, validation, and retry behaviour. Document any unavailable device/browser verification rather than claiming it passed.
- All primary actions work with touch alone; keyboard-open states keep focused fields and actions reachable. Larger-screen layouts preserve the same functionality.
- Required fields, length limits, and media limits are enforced server-side.
- Text survives refresh; errors preserve answers and support retry.
- Repeated requests for one submission attempt produce only one entry.
- Separate deliberate submissions with the same name are accepted.
- Anonymous users and non-owner accounts cannot read entries, photos, exports, or admin data, including via direct API requests.
- Owner can search, read, delete, export, and close submissions.
- Deleted entries do not leave accessible photos behind.
- Homepage contains no submitted content in V1.
- Final UI follows the separately supplied design Markdown brief and referenced SOP; visual sign-off remains pending until those documents are provided and applied.
- V2 showcase remains roadmap-only: no publication UI, public entry endpoints, or public storage bucket in V1.

## 12. Coding-agent deliverables
Working V1 application, SQL migrations and access policies, `.env.example` without secrets, setup/deployment README, and meaningful checks for authorisation, submission validation, idempotency, uploads, and closed submissions. Document required owner setup, storage policies, rate-limit configuration, and abandoned-upload cleanup. Keep dependencies minimal and avoid building V2 ahead of scope. Document the design brief and SOP used for the UI; if not yet supplied, explicitly mark visual design as pending.
