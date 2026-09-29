# Cross-repo asks: drafts

Date: 2026-09-29. Owner: Liam.

Status: drafts only. Nothing here has been filed, opened or pushed anywhere, and
nothing here is approved. The owner decides what to file, and when, after answering
the questions in [ADR-0001](../decisions/0001-companion-intelligence-integration.md)
(status: proposed, waiting for the owner). Each draft below is written to be pasted
into an issue or a pull request description.

Sources are the [rework plan](2026-09-29-ha-integration-rework.md) and reads of the
sibling repositories on 2026-09-29. The local sibling clones are partly stale, so
each citation says which branch or commit it was read at. Check it against the live
default branch before filing.

How the drafts are ordered: part 1 covers CI-Engineering and CI-Common (rules and
tooling), part 2 covers CI-Docs, CI-Marketplace and the asks to the CI-Hub and
CI-Server owners.

Timing rule that applies to every draft: nothing that becomes public (CI-Docs,
the CI-Marketplace listing text) merges before the owner has decided distribution
and licence (question 2 in ADR-0001, gate G3 in the plan). Drafts may be prepared
earlier.

---

## Part 1

### 1. CI-Engineering

#### 1.1 Register the decision record

Title: Register ADR for the Companion Intelligence Home Assistant integration
(CI-Home-Assistant-Voice-PE)

Body:

> CI-Home-Assistant-Voice-PE is being reworked from a voice-only bridge into a
> general Home Assistant integration to CI-Hub and CI-Server, keeping everything the
> voice path publishes (images, ports, program names, store listing) unchanged. The
> decision record is
> `docs/decisions/0001-companion-intelligence-integration.md` in that repository. Its
> status is Proposed, waiting for the owner. Please do not mark anything Accepted
> before the owner answers.
>
> Ask: register it in `adr/` here under the next free number (0013 on `main` at
> `d573ddc`, where 0012 is the latest, so check first) using
> `templates/adr.md`, with the Status left as Proposed. It covers the name
> (Companion Intelligence, domain `companion_intelligence`), the glossary that keeps
> `ci-server/` (voice facade), CI-Server (Companion Memory) and CI-Hub (Companion Hub)
> apart, the non goals, the Home Assistant floor (2025.10.0), the freeze list, what
> may leave the private repository, the licence stance, and uv as a bootstrap tool
> only inside `scripts/test-ha.sh`.

Evidence: ADR path above; `adr/README.md` (naming and lifecycle); `templates/adr.md`.

#### 1.2 Dated note under cut 5 of the improvement plan

Where: `architecture/improvement-plan-2026H2.md`, under cut 5 (line 268) and its
2026-08-05 re-score row (line 280). Both lines were read on 2026-09-29 in the local
clone at `d068a20`. That clone is behind GitHub `main` (`d573ddc`), where the file
last changed on 2026-09-05 (`c58b5ea`), so both lines hold there.

Draft text, in the plan's own marker style:

> **Δ 2026-09-29: cut 5 no longer applies to CI-Home-Assistant-Voice-PE.** The owner
> request of 2026-09-29 to rework that repository into a general integration
> supersedes cut 5 for that repository, pending approval of its ADR-0001. It was not
> frozen: 17 commits are dated after the 2026-08-05 re-score (2026-08-07 to
> 2026-09-28), including a licence change and the rebuild of the bridge, the facade
> and the site. It has a public store listing (`ci-ha-voice`) and a CI-Server connect
> grant. The rest of the device zoo (CI-OMI, CI-MaixCAM, CI-Pebble) is unaffected.

Do not file before the owner answers question 1 in ADR-0001.

#### 1.3 Generator entry for this repository

Where: `scripts/setup-agentic-configs.sh`, line 1087, `gen "CI-Home-Assistant-Voice-PE"`.

Problem (read on 2026-09-29): the entry says the stack is "Python / Home Assistant"
and "YAML configuration", the install command is `pip install -r requirements.txt`
(there is no root `requirements.txt`), and the test command is `pytest`. The files in
this repository (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) were
edited by hand to match reality, so the next org run reverts them. The stack is three
parts: `voice-bridge/` (pip), `ci-server/` and `web/` (npm), and the full check is
`scripts/test-all.sh`.

Draft replacement, using the `gen` argument order (layer, description, stack,
package manager, install, dev, test, build, connections, extra, allow list). Add the
integration sentence to the description only after ADR-0001 is accepted:

```bash
gen "CI-Home-Assistant-Voice-PE" \
  "Integration" \
  "Companion Voice for Home Assistant: a Wyoming voice bridge, an OpenAI-compatible facade and the ha.ci.computer setup site." \
  "- \`voice-bridge/\`: Python 3.12, asyncio, \`wyoming\` (Wyoming TCP server for Home Assistant)
- \`ci-server/\`: Node 20, TypeScript, Express (the voice facade, an OpenAI-compatible API; it is not CI-Server)
- \`web/\`: static site for https://ha.ci.computer, a Cloudflare Worker deployed with wrangler
- Docker Compose for the full stack" \
  "pip" \
  "cd voice-bridge && pip install -r requirements.txt -r requirements-dev.txt" \
  "docker compose up -d" \
  "scripts/test-all.sh" \
  "cd ci-server && npm ci && npm run build" \
  "- Home Assistant connects to voice-bridge over Wyoming (TCP 10700)
- ci-server grounds answers in CI-Server (Companion Memory) through /memory/context, /memory/recall and /memory/turn
- Under Companion Hub, ci-server can use the Hub inference pool and audio routes" \
  "## Package managers

pip for \`voice-bridge/\`, npm for \`ci-server/\` and \`web/\` (each has its own lockfile). Do not introduce yarn, pnpm or bun.

\`uv\` is allowed only as a bootstrap tool inside \`scripts/test-ha.sh\`, to fetch Python 3.14 and create the Home Assistant test venvs. Requirements are still installed with \`python -m pip install -r\`." \
  "      \"Bash(pip*)\",
      \"Bash(python*)\",
      \"Bash(npm:*)\",
"
```

Note on the template: `make_claude_md` prints "**pip** ... do not mix with
npm/yarn/pnpm/bun unless the repo explicitly requires it". This repository does
require npm for two directories, and the extra section above says so. If CI-Engineering
prefers a first-class field for a second package manager, that is a template change,
not part of this ask.

Do not file before ADR-0001 is accepted (the `uv` sentence cites it). Line 1087 was
read on 2026-09-29 in the local CI-Engineering clone at `d068a20`. On `main`
(`d573ddc`) the script last changed on 2026-09-20 (`bdafdd7`), before that commit, so
the line holds there. Check it again before filing, because generator entries move.

#### 1.4 ANTIGRAVITY and Copilot boilerplate

Problem: `ANTIGRAVITY.md` in this repository still carries the generator text
("Python / Home Assistant", `pip install -r requirements.txt`, `# start Home
Assistant`, `pytest`). `.github/copilot-instructions.md` carries the hand-edited stack
plus an architecture diagram (lines 7 to 11, with arrow characters) that the current
`make_copilot_md` no longer emits. Both are generated.

Ask: after 1.3 lands, run the generator for this repository so `ANTIGRAVITY.md` and
`.github/copilot-instructions.md` pick up the same stack, and confirm that the Copilot
diagram disappears. No hand edit is made here, because it would be reverted.

#### 1.5 Attribution generator (added in P0, not in the design)

Problem: `NOTICE.md` said "None" for copyleft while `THIRD_PARTY.md` lists `zeroconf`
0.88.0 as LGPL-2.1-or-later. This repository reconciled them by hand in P0. The
footers of `NOTICE.md`, `THIRD_PARTY.md` and `CREDITS.md` name
`scripts/generate-attribution.mjs`. That script exists on CI-Engineering `main`
(added 2026-09-28 by pull request 328, commit `f6814ba`) and is absent from the
local clone at `d068a20`, which is older. The footers here came in with `5948b0f`
(2026-09-21), six days before the script existed, and `aa94d81` (2026-09-28 00:06
UTC) later added the `pypi` rows to `THIRD_PARTY.md` in a form the script does not
write.

What the script does to this repository, read on `main` at `d573ddc` and run on a
scratch copy of `NOTICE.md`, `THIRD_PARTY.md`, `CREDITS.md` and `LICENSE.md` on
2026-09-29:

- It reads only `package.json` files: the repository root and its workspaces. This
  repository has no root `package.json` (its manifests are in `ci-server/` and
  `web/`, and the Python dependencies are in `voice-bridge/requirements.txt`). The
  scratch run rewrote `THIRD_PARTY.md` to "0 direct dependencies" and `CREDITS.md`
  to "declares no third-party package dependencies", which drops the `zeroconf`,
  `wyoming` and `aiohttp` rows and every npm row.
- It always writes "None. Every third-party dependency ... permissive licence" under
  the copyleft heading, because `generateForRepo` never passes `copyleftLines` to
  `buildNoticeMarkdown`, which would accept them.
- It does carry over a `NOTICE.md` block wrapped in
  `<!-- hand-authored: do not regenerate this section -->` and
  `<!-- end hand-authored -->`, but it writes that block above the "Copyleft and
  reciprocal-licence dependencies" heading, and the generated "None." still sits
  under the heading.
- Its "First-party code" line already links only the licence file that exists
  (`detectLicenseFilenames`), so there is nothing to ask there. `NOTICE.md` here had
  a broken `LICENSE` link in that line, and it was corrected by hand to what the
  script would print, `[LICENSE.md](LICENSE.md)`.

Stopgap in this repository: the `zeroconf` paragraph in `NOTICE.md` is wrapped in
those markers and opens with "One copyleft dependency:", so it reads correctly above
or below the heading. A regeneration would keep it, and would still print the false
"None." beneath it. `THIRD_PARTY.md` and `CREDITS.md` have no such protection, so do
not run the generator for this repository before the changes below land. The
generated footers are untouched.

Ask, two generator changes:

1. A way to pass copyleft lines to `buildNoticeMarkdown`, either detected from
   the collected licences (LGPL, GPL, MPL, AGPL, EPL) or given per repository.
2. Manifests beyond a root `package.json`: nested `package.json` files (here
   `ci-server/` and `web/`) and Python requirements files (here
   `voice-bridge/requirements.txt`), with licences from PyPI metadata.

### 2. CI-Common

Title: Update the "Surfaces with no brand exposure" exemption for
CI-Home-Assistant-Voice-PE

Body:

> `CONSUMING.md` lines 154 to 157 say: "CI-OMI, CI-MaixCAM, CI-Pebble,
> CI-Home-Assistant-Voice-PE carry no brand colour, logo or copy today and are exempt
> until they do." (Read at CI-Common `main`, `7c88159`, 2026-09-27.)
>
> That stopped being true for the setup site already: `web/public/styles.css` in
> CI-Home-Assistant-Voice-PE hard-codes the canon phthalo `#0a6358` and sage
> `#c5e8dc` (80 lines with a six-digit hex) and self-hosts Manrope. The planned
> integration adds a `brand/` folder of icons and an `/integration/` page, so the
> repository will carry brand colour, logo and copy as a whole.
>
> Ask: remove CI-Home-Assistant-Voice-PE from that sentence and list it as a Route B
> consumer (the brand bundle, `CONSUMING.md` lines 94 to 135, gate at line 137). The
> repository will pull the pinned bundle into a gitignored `vendor/brand/`, run
> `npx ci-lint-canon <dir> --tokens vendor/brand/tokens/tokens.json` on the new
> files only, and pin the sha256 of the committed derived icons.

Evidence and a correction to the plan: the plan and its task list say the gate flags
`web/public/styles.css`. On 2026-09-29 the v7 gate
(`packages/config/bin/lint-canon.ts` at `7c88159`, run with
`styles/tokens/src/tokens.json`) was run on a scratch copy of `web/public/styles.css`
and `web/public/index.html`. It printed "canon OK" with 14 non-blocking warnings, all
hard-coded hex values in the inline SVG of `index.html` (lines 64 to 95), and none for
`styles.css`. So this draft does not claim the gate fails. It claims the exemption
sentence is no longer accurate.

Do not file before ADR-0001 is accepted. The exemption lapses in P5, when the
integration adds brand files.

---

## Part 2

### 3. CI-Docs

Read on 2026-09-29 in the local clone. `origin/main` there is `aaba234` (2026-09-27)
and predates the rewritten voice page. The rewrite (pull request 215, branch
`claude/ha-voice-pe-docs`, `f15d8ed`) merged on 2026-09-28, so citations below to the
page text are to that branch.

#### 3.1 A sibling page for the general integration

Title: Add a Home Assistant integration page next to Home Assistant Voice PE

Body:

> CI-Home-Assistant-Voice-PE is proposed to gain a general Home Assistant
> integration, Companion Intelligence (`companion_intelligence`), beside the voice
> path. The voice page stays at its slug, `home-assistant-voice-pe`. It has four
> inbound links in this repository (`src/app/components/pages/home.tsx:199`,
> `src/content/docs/apps-available/first-party-apps/omi.mdx:53`, `_meta.ts:22` and
> `index.mdx:115` in `first-party-apps/`) and no `public/_redirects` rule, so a slug
> change would need a 301 there.
>
> Ask: add a sibling page, slug `home-assistant`, in the existing "Companion
> Integrations" group of `first-party-apps/_meta.ts` (the separator titled that, near
> line 13), next to
> `home-assistant-voice-pe`, that links to the voice page. Page content comes from the
> repository's `docs/integration/` pages when they exist (install, keys, privacy,
> removal). The Hub docs need only a link. CI-Docs owners please confirm the
> placement.

Hold the merge until the owner decides distribution (question 2). Until the
integration exists there is nothing true to publish beyond a stub.

#### 3.2 Scope the "no custom components" sentence

Where: `src/content/docs/apps-available/first-party-apps/home-assistant-voice-pe.mdx`
line 25 (branch `claude/ha-voice-pe-docs`): "The simplest setup uses only
`companion-conversation` and keeps Home Assistant's own faster-whisper and Piper
add-ons for speech. No custom components are needed."

Draft change: keep the sentence, and scope it to the voice path, for example: "The
voice path needs no custom component." The same scoping is made in this repository's
README (line 23) in P0. Ship it with 3.1, not before, because until the integration is
public the sentence is not misleading.

### 4. CI-Marketplace

Title: Optional listing text for `ci-ha-voice` once the integration is public

Body:

> The listing `apps/ci-ha-voice` (on `dev`, `visibility: public`, both images pinned
> to `sha-d5a7c86` digests, checked 2026-09-29) says "Zero-config on the Hub" and
> describes Wyoming only. Nothing tells a Hub user that a Home Assistant integration
> exists.
>
> Ask, after the owner decides distribution: add one sentence to
> `apps/ci-ha-voice/metadata/description.md` and to the `description` in
> `config.json`, pointing at the integration docs. Suggested sentence: "Home Assistant
> can also connect to your Hub and Companion Memory directly with the Companion
> Intelligence integration, see its docs for install steps." Fill in the docs address
> once it exists.
>
> Constraints from this repository's tests, which any edit must keep passing: `id`
> equals the folder name (`__tests__/deploy-via-portal.test.ts`, near line 53), the
> listing `port` (10780) is unique and grantable (`__tests__/apps.test.ts`, the port
> test near lines 1272 to 1328), and an app with `internal: true` carries the
> `companion-intelligence` category (`__tests__/internal-apps.test.ts`, near line 42).
> No id, pin, env name, form field, service name, port or version changes.
>
> Also for the owner of this listing: `source` (config.json line 17) points at the
> private repository and `website` and `documentation` (lines 18 and 19) point at the
> voice-only setup page. These change only when the owner decides distribution.

Evidence: `apps/ci-ha-voice/config.json` and `metadata/description.md` on
`origin/dev` in the local clone. The store app `home-assistant`
(`apps/home-assistant`) mounts `${APP_DATA_DIR}/data/config` at `/config` and has no
`hub_integration`, so it receives no `CI_LLM_*` or Memory variables. That is context
for the integration's install docs, not a request to change it.

### 5. CI-Hub owners

Read on 2026-09-29 in the local CI-Hub clone (branch `claude/voice-pe-audio-routes`,
commit `e45fb14`, shallow, no tags). Route release dates below come from the plan's
checks of GitHub tags on the same day and were not re-run here.

#### 5.1 Is there an advertiser for `_ci-hub._tcp.local.`?

> The Hub desktop app browses `_ci-hub._tcp.local.`
> (`packages/desktop/src-tauri/src/discovery.rs:5`; `docs/ARCHITECTURE.md:468`). A
> search of this clone for `mdns`, `avahi` and `ServiceInfo` found only that browser,
> plus a macOS resolver restart in `commands/dns.rs`, and no service that advertises
> the type. Is there an advertiser elsewhere (CI-OS, for example), and if so what does
> it publish (port, TXT records, node id)? If there is none, is one planned?
>
> Why we ask: a Home Assistant integration could offer a discovered Hub. Today it
> offers a typed address only. Nothing will be built on discovery until an advertiser
> is confirmed.

#### 5.2 A per-route "first release" table

> The integration reads these Hub routes: `GET /api/inference/pool/identify`,
> `GET /api/health/live`, `GET /api/hub/build`, `GET /api/inference/health` (fields
> `status`, `hardwareTier`, `backends[]`, `cloudFallback`),
> `GET /api/inference/v1/models` and streaming
> `POST /api/inference/v1/chat/completions` with the `X-Hub-Pool-Session` header.
> From tags we could place three: identify is between v0.2.61 and v0.2.70, key access
> to inference (the `inference` scope and 401 codes) is v0.2.73, and
> `GET /api/hub/build` is v0.2.74. We could not place the rest, including the release
> that first reports `cloudFallback`.
>
> Ask: a small table of the first release per route, so the integration's minimum
> releases table can be exact instead of "unchecked".

#### 5.3 Seeding the integration into a Hub-run Home Assistant

> The store app `home-assistant` runs Home Assistant with `/config` on the Hub host.
> Should the Hub ever put the Companion Intelligence folder into that config
> directory for the user? The plan defers this. It needs its own decision: the
> integration is under PolyForm Noncommercial, Lifescope as licensor is not bound by
> it, but a third party selling an appliance that ships it is (ADR-0001, decision
> 7). Nothing here asks for it now. We ask whether it is wanted, so the plan can
> record the answer.

#### 5.4 `min_hub_version` of the `ci-ha-voice` listing

> The listing says `min_hub_version` v0.2.41. The Hub's multipart audio upload fix
> (CI-Hub pull request 1643, merged to `dev` on 2026-09-28, commit `e45fb14`) is what
> lets the voice stack use Hub speech, and per the plan it was in no tagged release
> on 2026-09-29 (the latest tag was v0.2.76). Once a tag carries it, should the
> listing's `min_hub_version` rise to that release? Voice with Home Assistant's own
> Whisper and Piper does not need it.

#### 5.5 A question about the unauthenticated guest route (private channel)

> `GET /apps/guest` is served without `AuthGuard`
> (`packages/backend/src/modules/apps/apps.controller.ts:89`), and its DTO comment
> (`dto/app.dto.ts`, around line 66) says the payload is the set of app facts anyone
> on the network may read. We could not tell from source whether that payload can
> include an app's `config` (the values from its install form, such as a generated
> key). We did not test it against a live Hub, and this is an inference, not a
> finding. Could you confirm it cannot?

Send this one through the private security channel described in
`CI-Engineering/resources/security-policies.md`, not a public issue. If the answer is
that it can, treat it as a security report from that point.

### 6. CI-Server owners

#### 6.1 Where does a person delete saved turns?

> The voice stack saves each exchange to Companion Memory with `POST /memory/turn`
> (platform `ha-voice-pe`, on by default through `CI_MEMORY_SAVE_TURNS=true`). The
> proposed Home Assistant integration would save turns too, opt in, under platform
> `home-assistant`. Both use a key with scope `memory` and capability `write`, which
> by design cannot delete (CI-Server pull request 2746: "a kitchen speaker should
> never hold delete authority"). The integration offers no `forget`.
>
> Question: where does a person find and delete those saved conversations? A UI path
> is enough, and so is an API route with the key or scope it needs. Can they be found
> by platform label?
>
> Why we ask: the removal guide has to tell people how to delete what the integration
> and the voice stack saved, and today it can only say that where a person deletes
> them is unverified.

Evidence: `ci-server/src/memory/index.ts` (the `/memory/turn` call and the platform
default); `.env.example` (`CI_MEMORY_SAVE_TURNS=true`); CI-Server `main` at `e4f355c`,
`backend/apps/api/src/domains/agent/controllers/MemoryController.ts` (the turn route).
