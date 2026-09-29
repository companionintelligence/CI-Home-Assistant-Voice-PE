# ADR-0001: Companion Intelligence, a general Home Assistant integration

> Private and confidential. Property of Lifescope Inc. Do not distribute.

| Field         | Value                                |
| ------------- | ------------------------------------ |
| **Status**    | Proposed, waiting for the owner      |
| **Date**      | 2026-09-29                           |
| **Owner**     | Liam                                 |
| **Author(s)** | Drafted by Claude Code for the owner |
| **Reviewers** | None yet                             |

> **Nothing in this record is decided.** Every "we propose" below is a proposal
> from the design in [the rework plan](../plans/2026-09-29-ha-integration-rework.md).
> The owner has not approved the name, the domain, the licence handling or the
> retirement of improvement-plan cut 5. Only the owner changes the Status line, and
> the answer is written into "Owner answers" with its date. Until then the plan
> lets docs (P0) and the voice guards (P1: tests, checks and release safeguards)
> land, because none of them changes what the voice bridge or the facade does at
> run time, and holds P2 (the first phase that writes the domain into a manifest).
>
> **A separate change sits in the same working tree and is not part of the plan.**
> Edits under `voice-bridge/src/` do change how the bridge behaves. They are not
> approved, not published and not decided by this record. See "Voice bridge changes
> waiting in the working tree" below, and owner question 5.

## Context

This repository ships Companion Voice for Home Assistant today: a Wyoming server
(`voice-bridge/`), an OpenAI-compatible facade (`ci-server/`), a setup site
(`web/`) and a public Companion Hub store listing (`ci-ha-voice`). On 2026-09-29
the owner asked for two things at once: keep the voice system working exactly as
people use it today, and rework the repository into a general Home Assistant
integration to CI-Hub and CI-Server.

Core Home Assistant already reaches a Hub model pool (the `ollama` and `litellm`
integrations). What it cannot do is ground answers in Companion Memory, offer
Companion tools to any agent, or show Hub and Memory health with repairs. The
plan adds a custom component, `custom_components/companion_intelligence/`, beside
the voice stack. It moves and removes nothing.

## Glossary: three names that stay apart

Everywhere in this repository, in code, docs, issues and commit messages, these
three names mean exactly one thing each.

| Written as | Means | Notes |
|---|---|---|
| `ci-server/` (lowercase, with a slash, a directory) | The voice facade in this repository: Node 20, TypeScript, Express, an OpenAI-compatible API on HTTP 8080. It is the Docker context of the image `ci-ha-voice-server`. | It is not CI-Server. It forwards chat and speech to a model and calls CI-Server for memory. |
| CI-Server (capitalized, no slash) | Companion Memory: the memory brain of the platform, in the repository `companionintelligence/CI-Server`. This repository reaches it through `/memory/context`, `/memory/recall` and `/memory/turn` (the memory API lives under `<origin>/api`). | Cite CI-Server `main` on GitHub, not a stale local clone. |
| CI-Hub | Companion Hub: the app runtime and inference pool, in the repository `companionintelligence/CI-Hub`. It hosts the store listing `ci-ha-voice` and serves the inference API this repository calls. | Hub is not the Portal (`hub.ci.computer` is the Portal). |

Related names used in this record:

- **Companion Voice** is the feature name of the voice path (the Wyoming bridge,
  the facade and the setup site). It stays the name of that path and is not the
  umbrella.
- **Companion Intelligence** is the proposed display name of the integration.
- `companion_intelligence` is the proposed integration domain.
- **Companion Memory** is the product name of CI-Server as a memory store.
- `voice-bridge/` is the Wyoming TCP server, the Docker context of `ci-ha-voice-bridge`.

## Proposed decisions

### 1. Name and domain

We propose the display name **Companion Intelligence** and the domain
`companion_intelligence`. Voice stays a feature name (Companion Voice). We avoid
`ci_server` and `ci_hub` (they repeat the facade confusion above), bare `companion`
(it collides with the Home Assistant app) and Companion Voice as the umbrella.

Evidence, checked 2026-09-29 on the PyPI wheel of `homeassistant` 2026.9.4: it
holds 1,509 component directories, and none is named `companion_intelligence`,
`companion`, `ci_server` or `ci_hub`. A custom integration outside core can still
use any of them, and that was not searched.

The domain is free to change until P2. After entities exist it needs a migration,
so this is the irreversible part and the owner's answer to question 1 gates it.
The manifest `codeowners` handle also comes from that answer, and it is not known.

The GitHub repository keeps its name (`CI-Home-Assistant-Voice-PE`), because the
CI-Engineering generator aborts its whole org run on a renamed repository.

### 2. Shape

We propose an additive, native shape: new code beside the voice stack, nothing
moved. No directory is moved, renamed or removed, including `ci-server/`. The
integration talks straight to Hub and Memory. The facade and the bridge stay
optional companions that it can observe. Voice needs no custom component and keeps
working with the integration absent.

### 3. Non goals

We propose that the integration does not:

- use the Hub session REST API (`/api/apps/*`, `/api/app-lifecycle/*`,
  `/api/system/*`), its SSE routes, `GET /api/apps/guest` or the credentials
  endpoint. The session and credentials routes need a Hub session or a container,
  SSE cannot use a key, and `GET /api/apps/guest` is unauthenticated and not an
  integration surface.
- ask for a Portal password or any Portal login.
- offer `forget`. It stays a later item: it needs confirmation and an approval
  flow, because the underlying intent needs capability `full`.
- install, uninstall, update or reset anything on a Hub.
- rely on a new Hub app id (a new store listing that gets Hub-brokered keys)
  before its CI-Server case exists. The rule is: no new Hub app id before its
  `scopesForApp` and `capabilityForApp` case is merged and deployed in CI-Server.
  On CI-Server main an unlisted app id gets the `memory`, `intents` and `mcp`
  scopes at write, which is wider than needed. Until the case exists the
  integration uses hand-made, scoped keys.

The same rule also rules out a Hub connect key, a `qa:read` key, an empty-scope
key and a Hub MCP key with capability `full`.

### 4. Home Assistant floor

We propose a floor of Home Assistant **2025.10.0** (declared as three parts). We
develop on 2026.9.x. The source has to be valid on Python 3.13, and version
branches live only in `compat.py`. The default test run uses 2026.9.4 and
2025.10.4. A matrix adds 2026.8.3 (the last 2026.8 patch: 2026.8.0 is the first
release with `llm.py` platforms and device registry v3, and 2026.7.4 has neither)
and 2026.2.3 (the last release that runs on Python 3.13), and it must be green
before P3, P4 and P6 merge and before any release zip is built.

PyPI metadata confirms the interpreter boundary (checked 2026-09-29):
`homeassistant` 2025.10.4 and 2026.2.3 require Python 3.13.2 or newer, and 2026.3.4,
2026.8.3 and 2026.9.4 require 3.14.2 or newer. The `llm.py` and registry claim
above was checked the same day by unpacking the wheels: 2026.7.4 has no `llm.py`
platform file and device registry storage major version 1, and 2026.8.0, 2026.8.1,
2026.8.2 and 2026.8.3 each have 15 `llm.py` files and major version 3. No
install-base data was reachable, so the floor is a judgment. Raising it to 2026.9.0 would delete the compatibility
shims and exclude everyone who is not on the newest month.

### 5. Freeze list

We propose to freeze the following. The rework plan (P0 to P7) changes none of
them, and P1 adds tests that fail when one changes. "Frozen" means byte or name
compatible with what exists today. The bridge changes waiting in the working tree
(see the section after decision 10) keep every name below, but they are outside the
plan and they do change some behaviour of the bridge.

Voice runtime

- Wyoming TCP port 10700, the programs `companion-stt`, `companion-tts` and
  `companion-conversation`, and the zeroconf name `companion-voice`. The names are
  frozen. The published bridge always offers all three. The unpublished bridge does
  too by default, and offers `companion-stt` and `companion-tts` only while
  ci-server's `/v1/status` reports a speech provider other than `none` when the
  option `HIDE_UNCONFIGURED_SPEECH` is switched on (see below). With that option on
  and no speech configured, the Wyoming entry is titled `companion-conversation`.
- The facade HTTP contract on 8080. Its `/v1/status` field names (`version`,
  `default_model`, `llm`, `stt`, `tts`, `memory`) can only gain fields.
- Every environment variable name in `.env.example` and in both compose files.
- The Memory platform label `ha-voice-pe` (`CI_MEMORY_PLATFORM` default). The
  integration writes its own label, `home-assistant`, so the two histories stay
  separable.

Images and releases

- GHCR `ghcr.io/companionintelligence/ci-ha-voice-server` (built from `ci-server/`)
  and `ghcr.io/companionintelligence/ci-ha-voice-bridge` (built from
  `voice-bridge/`), the tags `latest` and `sha-d5a7c86`, and the digests the Hub
  listing pins. Nothing is deleted or retagged. The rework plan gives the two Docker
  contexts no functional edit. The bridge changes waiting in the working tree are
  the exception: they are not part of the plan, and no image built from them exists.
- The `v*` tag trigger of `publish-images.yml`, its matrix contexts and the OCI
  labels title, vendor and url.

Compose and site

- `docker-compose.yml` with its service keys `ci-server` and `voice-bridge`.
- `web/public/compose.yml` byte for byte, served as `text/yaml` inline, never as a
  redirect.
- https://ha.ci.computer, its title "Companion Voice for Home Assistant", the
  Worker `ci-ha-voice-setup` and its custom domain, and the browser storage key
  `ci-ha-voice-setup-v1`.

Store and Memory

- The Hub store listing `ci-ha-voice` in CI-Marketplace: id, image pins, the env
  names `CI_LLM_BASE_URL`, `CI_LLM_API_KEY`, `CI_CHAT_MODEL`, `CI_MEMORY_URL` and
  `CI_MEMORY_API_KEY`, the form fields, the service names `ci-ha-voice-server` and
  `ci-ha-voice-bridge`, `CI_SERVER_URL=http://ci-ha-voice-server:8080`, bridge host
  port 10700, listing port 10780, version 1.1.0 and `min_hub_version` v0.2.41.
  Also the store deep link `https://hub.ci.computer/install#ci-ha-voice`.
- The CI-Server grant for `ci-ha-voice` (scope `memory`, capability `write`).

Repository

- The directory names `ci-server/`, `voice-bridge/`, `web/`, `e2e/`, `db/`,
  `scripts/` and `docs/`, the test suites and their entry points
  (`scripts/test-all.sh`), and the package managers (see decision 8).
- `LICENSE.md` line 3, the PolyForm Required Notice.

The integration's own promises, frozen from 0.1.0: the domain, the config entry
keys, the subentry types, `VERSION` and `MINOR_VERSION`, the unique id rule, the
service names, the LLM API tool names and the label `home-assistant`.

The guard is `contracts/frozen-surfaces.json` plus a test that reads the repository
files and asserts every value. P1 adds both. This record names what is frozen, and
the JSON is the machine-checked copy.

### 6. What may leave the private repository

We propose that nothing new leaves this repository until the owner decides
visibility and licence (question 2). The repository is private, licensed under
PolyForm Noncommercial, and marked private and confidential in `CLAUDE.md`. So:

- no integration zip on ha.ci.computer, no HACS listing (HACS cannot use a private
  repository), no public mirror, and no deployed `/integration/` page. The page may
  be merged, but `web/public/.assetsignore` keeps it out of the site deploy until
  the owner decides.
- a private release zip may be built and attached privately. It contains only the
  integration folder and `LICENSE.md`. Anyone who can install it has repository
  access.
- drafts for other repositories stay in `docs/plans/cross-repo-asks.md`. Nothing is
  filed, opened or pushed for the owner.
- nothing is announced or released until the Voice PE hardware test and the launch
  post from [the launch plan](../plans/2026-09-28-ha-voice-launch.md) are done. The
  README rewrite waits for P5, and P0 changes only line 23.

Already published or referenced, and untouched by this work: the images and site
listed in decision 5, and the store listing, which is public (`"visibility":
"public"` on CI-Marketplace `dev`). That listing's `source` field points at this
private repository, so outsiders get a 404 today, and its `website` and
`documentation` fields point at the voice-only setup page, which is the wrong page
for a Hub user of the integration. That is part of question 2.

### 7. Licence stance

We propose this handling. The wording changes it mentions wait for the owner.

- No code is copied from Home Assistant core. Structure follows the documented
  subentry, streaming and manifest patterns. If a core file is ever adapted, the
  same pull request adds an Apache-2.0 line to `NOTICE.md`, because core is
  Apache-2.0.
- `LICENSE.md` line 3 (the Required Notice) is frozen by a test, because PolyForm
  requires copies to carry it and the release zip ships `LICENSE.md`.
- The `LICENSE.md` line 1 banner and `docs/License-FAQ.md` change only with wording
  the owner approves. P5 drafts it. Today both name only the voice product.
- Lifescope as licensor is not bound by PolyForm Noncommercial. A third party that
  sells an appliance shipping the integration is bound by it: the License FAQ says
  selling appliances that ship the code is not permitted.
- Whether the Hub may seed the integration into a Hub-run Home Assistant is
  deferred. It is not proposed here.

### 8. Tooling: uv is a bootstrap tool, only inside `scripts/test-ha.sh`

We propose that pip stays the manager for `voice-bridge/` and for the Home
Assistant test environments, and npm for `ci-server/` and `web/`. No yarn, pnpm or
bun, no `pyproject.toml` and no uv lockfile.

`uv` is allowed in exactly one place: `scripts/test-ha.sh` (a script the plan adds
in P2, so it does not exist yet), to fetch Python 3.14 and create the Home Assistant
test venvs (`uv venv --seed`). Every requirements file is
still installed with `python -m pip install -r` inside those venvs. The reason is
that Home Assistant 2026.3 and newer needs Python 3.14.2, which the system Pythons
do not provide. The stock uv 0.8.17 only offers Python 3.14.0rc2 (checked
2026-09-29 with `uv python list --only-downloads`), so the script bootstraps uv 0.12
from PyPI (the design used 0.12.20, which exists on PyPI, released 2026-09-28).

The generator entry drafted in `docs/plans/cross-repo-asks.md` names uv as an
allowed bootstrap tool, so an agent neither treats it as forbidden nor spreads it.

### 9. Arrow characters: fixed and left on purpose

The style for new text is no arrows, no dashes used as dashes and no emojis. Existing
arrows, found by scanning every tracked file on 2026-09-29:

| Where | Character | Handling |
|---|---|---|
| `ci-server/package.json` line 4 (`description`) | U+2194 | Fixed in P1. It is user-visible package metadata. |
| `ci-server/src/normalizers/index.ts` lines 40 and 96 (doc comments) | U+2192 | Left on purpose. A comment edit inside a Docker context costs an image rebuild for nothing. |
| `.github/copilot-instructions.md` lines 8 and 9 | U+2192, U+2190, U+2195 | Left on purpose. The file is generated, and the next org run rewrites it (the current generator template has no diagram). A hand edit would only be reverted. |

The two comment-only corrections in `ci-server/src/routes/status.ts` and
`ci-server/tests/status.test.ts` are fixed in P1 because their text is factually
stale, not because of a character. Comment-only fixes in the facade ride the next
functional change and are not published on their own.

### 10. Dated note on improvement-plan cut 5 (2026-09-29)

Cut 5 of `architecture/improvement-plan-2026H2.md` in CI-Engineering, "Freeze the
device zoo", lists this repository at line 268. The 2026-08-05 re-score of the same
plan, at line 280, marks the cut "Inverted" and says to "re-apply the freeze to the
rest (CI-OMI, CI-MaixCAM, CI-Pebble, CI-Home-Assistant-Voice-PE)". Both lines were
read on 2026-09-29 in the local CI-Engineering clone at commit d068a20. That clone
is behind GitHub `main` (d573ddc, 2026-09-28), so the file's history was also
checked there: `improvement-plan-2026H2.md` last changed on 2026-09-05 (c58b5ea),
before d068a20, so both line numbers hold on `main`.

This repository was not frozen, and the record shows it:

- The last commit before the re-score is bab4db4 (2026-06-09). 17 commits are dated
  2026-08-07 or later, up to the merge d5a7c86 (2026-09-28 05:23 UTC).
- Its newest commits, dba1e32 (authored 2026-09-28 04:25 UTC) and the merge d5a7c86,
  both come after the re-score.
- The work since then includes a licence change (a5c59de, 2026-09-10), an auth fix
  (4d3ad84, 2026-08-26) and the rebuild of the bridge, the facade and the site.
- It has a public store listing (`ci-ha-voice`) and a CI-Server connect grant.

The owner request of 2026-09-29 to rework this repository into a general
integration supersedes cut 5 for this repository, pending approval of this record.
The rework also fits the last sentence of cut 5 ("Voice = integrate with Home
Assistant Assist"): it adds an Assist conversation agent and status entities and
builds no assistant of its own. Question 1 asks the owner to confirm. The plan
text in CI-Engineering is unchanged, and the edit is drafted, not filed, in
`docs/plans/cross-repo-asks.md`.

## Voice bridge changes waiting in the working tree

Not part of the proposal above, not approved, not published. This section keeps
the record true about the tree it sits in: the rework plan describes the voice path
as untouched, and the working tree holds edits that touch it. Facts below were
read from the files and run on 2026-09-29. The bridge files were still being edited
that day, so check them again before relying on a detail.

**What they are.** Edits to `voice-bridge/src/client/ci_client.py`,
`voice-bridge/src/config.py`, `voice-bridge/src/wyoming/handler.py` and
`voice-bridge/src/wyoming/info.py`, with new and changed tests under
`voice-bridge/tests/`. They answer defects found in an audit of the bridge: every
transcript logged in plain text, a pipeline that hangs after an error event,
malformed events that end the connection silently, and every failure spoken as if
the server were unreachable. The only edit under `ci-server/src/` is a comment. No
image was built from any of this: the registry holds only `latest` and `sha-d5a7c86`,
at the same digests ([releasing](../releasing.md)).

**Behaviour changes at default settings.** Each one changes how the bridge acts
today.

1. An `error` event now ends the connection. The bridge writes the event and then
   closes, for speech-to-text, text-to-speech and unreadable events alike. Reading
   `wyoming/stt.py` and `wyoming/tts.py` in the wheels, Home Assistant 2025.11.3
   through 2026.7.4 never look at an error event and wait for a transcript or audio
   with no timeout of their own, so today a failed request can leave the pipeline
   waiting. 2026.8.3 reads the error and stops.
2. Failures are spoken by cause. A failed conversation request always spoke "Sorry,
   I could not reach Companion Intelligence right now." That sentence stays for a
   facade that is down or answers with a 5xx. Four are new: a rejected key (HTTP 401
   or 403), "Sorry, Companion Intelligence did not accept my API key. Please check
   the voice bridge settings."; too many requests (429), "... is busy right now.
   Please try again in a moment."; a timeout, "... took too long to answer."; and a
   body the bridge cannot use (an empty reply, invalid JSON, or another 4xx),
   "... sent back something I could not understand." An empty reply used to speak
   the could-not-reach sentence.
3. Speech-to-text and text-to-speech error texts name the cause and are never
   empty, for example "Transcription failed (auth): HTTP 401: ...". Before, the
   prefix was doubled and a timeout gave an empty message.
4. An event the bridge cannot parse or handle (missing fields, wrong types, a bad
   audio format) is answered with an `error` event, code `invalid-event`, and the
   connection closes. Before, the connection ended with no reply and a traceback
   about an exception nobody retrieved.
5. Transcripts and replies are no longer logged by default. The log says
   "Transcript received (N characters)" and "Reply sent (N characters)".
   `LOG_TRANSCRIPTS=true` (also 1, yes or on) brings the text back for
   troubleshooting.
6. A conversation turn enters the bridge's short history only after the answer has
   been written to Home Assistant. Before, it was stored first, so an answer that
   never arrived still counted.

**Off by default.** `HIDE_UNCONFIGURED_SPEECH=true` makes each Describe ask
ci-server's `/v1/status` and leave `companion-stt` or `companion-tts` out when its
provider is `none`. It is off, so the default Describe is the same three programs
as today. Checked on 2026-09-29 in the Home Assistant 2026.9.4 container, using
scratch copies of `scripts/voice-container-smoke.sh` with the facade started
without `STT_BASE_URL` and `TTS_BASE_URL`: with the option unset, the Wyoming entry
is titled `companion-stt` and all three entities exist and answer; with it on, the
entry is titled `companion-conversation` and its only entity is
`conversation.companion_conversation`. Home Assistant picks the platforms of a
Wyoming entry (speech-to-text, text-to-speech, conversation) from the answer it gets
when the entry loads (`wyoming/data.py` and `wyoming/__init__.py` in 2026.9.4), so
after the facade's speech settings change, the Wyoming entry has to be reloaded.

**Not changed.** Port 10700, the three program names, the zeroconf name, the calls
to the facade (`/v1/audio/transcriptions`, `/v1/responses`, `/v1/audio/speech`), and
every environment variable name in `.env.example` and both compose files. The new
variables are additions.

**`DEBUG`.** `voice-bridge/main.py` used to turn debug logging on for any non-empty
`DEBUG`, so `DEBUG=0` and `DEBUG=false` also turned it on. It now asks
`debug_enabled()` in `config.py`, which accepts only 1, true, yes and on. Someone who
relied on another value, for example `DEBUG=debug`, no longer gets debug logging.
This is the one edit outside `voice-bridge/src/` and `voice-bridge/tests/` (two
lines in `main.py`).

**Optional variables.**

| Variable | Default | Effect |
|---|---|---|
| `LOG_TRANSCRIPTS` | off | Log what people say and what they hear back. Use while troubleshooting only. |
| `HIDE_UNCONFIGURED_SPEECH` | off | Leave out speech services that the facade reports as `none`. |
| `DEBUG` | off | Debug logging. Only 1, true, yes and on count. |

None of the three is in `.env.example`, `docker-compose.yml` or
`web/public/compose.yml`, and both compose files pass the bridge an explicit list of
variables, so a value in `.env` never reaches the container. Use a compose override
file, for example a `docker-compose.override.yml` containing `services:`,
`voice-bridge:`, `environment:` and `LOG_TRANSCRIPTS: "true"` (checked with
`docker compose config`, which then lists the variable in the bridge's
environment). It only has an effect in an image built from the changed source. The
Hub listing has no form field for them.

**Who would get it, and when.** Merging publishes no image.

- A stack started from a checkout with `docker compose up -d --build` (the root
  `docker-compose.yml` builds `./voice-bridge`) gets it at the first rebuild after
  the checkout includes these edits.
- A stack started from https://ha.ci.computer/compose.yml pulls `:latest` for both
  images. It gets it only after someone publishes (a `v*` tag without a hyphen, or a
  dispatch of `publish-images.yml` on `main`) and runs `docker compose pull`.
- Hub installs pin `sha-d5a7c86` by digest in the listing, so they get it only after
  the listing's pins change and merge.

**Documents that describe the published behaviour.** `README.md` line 55 says the
bridge turns "its three services" into entities, which stays true by default and is
wrong only with `HIDE_UNCONFIGURED_SPEECH` on. The README troubleshooting row at
line 208 ("lights up but never answers") points only at the model, but a wrong
`CI_SERVER_API_KEY` would now be spoken as an API key problem. The site hint at
`web/public/index.html` line 328 says Home Assistant "then shows three services",
which is the same default. The site is frozen (decision 5), and the README changes
wait for the owner's answer to question 5 (P0 changes only README line 23).

**What the owner has to decide (question 5).** The owner asked that voice keep
working exactly as people use it today. Items 1 to 6 change what people hear, what
the pipeline does after an error or what the log shows, on the default path, so this
record does not treat any of them as decided. The rework plan's own P1 gate, "no
functional edit under `voice-bridge/src`", is met only when these edits are held out
of the branch. Options: keep them in this branch and publish them in a later release;
carry them in a separate pull request; or take some and drop the rest. None is
chosen here.

## Alternatives considered

Three shapes (conservative, clean, native) were compared during planning. The
comparison notes are not part of this repository, so they are not restated here.
Native ranked first and the plan starts from it. Alternatives the plan names and
declines:

- **Move or rename directories, including `ci-server/`.** The only gain is clarity.
  It conflicts with parallel agents, reverts generated agent files, and a stale path
  makes `e2e/test_stack.py` skip with exit 0. The glossary above fixes the confusion
  in words. Reopen if `ci-server/` and CI-Server are mixed up twice by a contributor.
- **Rename the GitHub repository.** Costs a generator change in the same window.
- **Build on the facade.** It drops `tool_calls` in non-streaming chat, its
  `/v1/responses` is text only and `response_format` is not forwarded. Extending it
  changes a Docker context and needs a deliberate publish.
- **Other names** (`ci_server`, `ci_hub`, `companion`, Companion Voice as the
  umbrella). See decision 1.

## Consequences

### Benefits

- The integration cannot make voice regress by accident: additive code, a
  frozen-surface guard and an end-to-end check that fails instead of skipping. The
  bridge changes above are a separate matter.
- One page keeps the three names apart, and Hub and Memory get honest health and
  repairs in Home Assistant.
- It is the only shape one maintainer can test without a live Hub or CI-Server.

### Risks and trade-offs

- The name and domain are irreversible once entities exist.
- The repository is private, so HACS and a public zip are closed until question 2 is
  answered, and the manifest and listing links stay 404 for outsiders.
- Every fake in the test rig is derived from source, because no live Hub or
  CI-Server was reachable while planning. The owner's live check (gate G1) corrects
  them.
- Home Assistant shows no integration icon before the 2026.3 series. That is accepted.

### Migration and adoption

The integration asks nothing of people who run voice today: the Wyoming entry, the
Assist pipeline, the compose stack or the Hub store app, and both published images
keep working, and the integration never edits or replaces the Wyoming entry.

That is true of the integration only. The bridge changes waiting in the working
tree (section above) are separate and unapproved. Until an image or a rebuilt
checkout carries them, no voice setup changes. When one does, the list above says
what people would notice, and the answer to question 5 comes first.

## Errata to the rework plan

The plan is a copy of the design with one Status line added. Reviewers found the
statements below wrong or stale after it was copied. The plan text is left as
copied, so where it and this table differ, this table wins until the plan is copied
again. Line numbers are those of the plan file.

| Plan line | The plan says | Correction |
|---|---|---|
| 13, 176, 183, 402, 424, 501 | The voice path is untouched: "leaves voice untouched", images "Unchanged" with "no functional edit", "Bridge untouched", "Nothing changes", and the P1 gate "no functional edit under `ci-server/src` or `voice-bridge/src`". | These describe the plan. The working tree also holds bridge edits that the plan does not cover (section "Voice bridge changes waiting in the working tree"). The line 501 gate fails for `voice-bridge/src` while they are in the branch. |
| 32 | 2026.8.3 is the "first release with `llm.py` platforms and device registry v3". | 2026.8.3 is the last 2026.8 patch. 2026.8.0 is the first release with both, and 2026.7.4 has neither (wheel scan, decision 4). |
| 180 | The CI-Marketplace tests are at `apps.test.ts:238-296, 1272-1328` and `internal-apps.test.ts:42`. | `apps.test.ts:238-296` is schema code. The id-equals-folder test is `__tests__/deploy-via-portal.test.ts:53`, the port test is `apps.test.ts:1272-1328`, and the category test is `internal-apps.test.ts:42` (CI-Marketplace `dev`, checked 2026-09-29). |
| 202 | "`NOTICE.md:8-9` says no copyleft", and `scripts/generate-attribution.mjs` "is absent from the local CI-Engineering clone". | At HEAD the "None." text is on `NOTICE.md` lines 10 and 11 (line 8 is the heading). The generator is absent from the local clone at d068a20 but exists on CI-Engineering `main` (added 2026-09-28 in pull request 328). It reads only `package.json` files, and this repository has none at its root, so a regeneration would empty `THIRD_PARTY.md` and `CREDITS.md`. Draft 1.5 in [cross-repo asks](../plans/cross-repo-asks.md) covers it. |
| 220, 429, 537, 740 | The voice step prefills the host when exactly one core `wyoming` entry is "titled `companion-stt`" on port 10700. | The title is the first service the bridge offers, so it is `companion-conversation` when speech is left out (`HIDE_UNCONFIGURED_SPEECH` on and no speech configured). Match a single Wyoming entry on port 10700 whatever its title. |
| 506 | Real Home Assistant 2026.9.4 shows `companion-stt`, `companion-tts` and `companion-conversation`. | True by default, and whenever the facade has speech configured. With `HIDE_UNCONFIGURED_SPEECH` on and no speech, only `companion-conversation` shows. |
| 706 | "`ci-lint-canon` flags `web/public/styles.css`". | It does not. The v7 gate printed "canon OK" for `styles.css` on 2026-09-29. What has lapsed is the CI-Common sentence that exempts this repository (draft 2 in cross-repo asks). |

## Owner answers

None given yet. When the owner answers, each answer goes here with its date and the
owner's own words, and the Status line changes in the same commit.

| # | Question | Answer |
|---|---|---|
| 1 | Approve the name Companion Intelligence and the domain `companion_intelligence`, give the GitHub handle for `codeowners`, and confirm that improvement-plan cut 5 no longer applies to this repository. Blocks P2. | Not yet answered |
| 2 | Distribution and licence: (a) stay private and hand the release zip to people with repository access, (b) publish the zip at ha.ci.computer, (c) go public after a history scrub and use a HACS custom repository, or (d) a separate public mirror. The plan recommends (a) until the launch post is out. Also the `LICENSE.md` banner wording, the License FAQ paragraph and the public security contact. Blocks the deploy of `/integration/`, any public zip and the manifest link switch, not the merge of P5. | Not yet answered |
| 3 | Live checks only the owner can run: `scripts/live-check.py` (planned, not written yet) against a real Hub and Companion Memory before P4 merges, and a Voice PE hardware pass on both agents before any release. | Not yet done |
| 4 | Check GHCR package insights for `ci-ha-voice-server` and `ci-ha-voice-bridge`, to size the cost of a bad `latest`. | Not yet done |
| 5 | The voice bridge changes waiting in the working tree (section "Voice bridge changes waiting in the working tree"): keep them in this branch, carry them in a separate pull request, or take some and drop the rest, and whether and when to publish them. Items 1 to 6 change default behaviour, so each needs a yes. | Not yet answered |

## References

- [Rework plan](../plans/2026-09-29-ha-integration-rework.md), the source of every
  proposal above.
- [Architecture](../architecture.md): glossary, diagram and what runs where.
- [Launch plan](../plans/2026-09-28-ha-voice-launch.md).
- [Releasing](../releasing.md): how the images are published and rolled back.
- [Cross-repo asks](../plans/cross-repo-asks.md): drafts, nothing filed.
- [License FAQ](../License-FAQ.md) and [LICENSE.md](../../LICENSE.md).
- CI-Engineering `architecture/improvement-plan-2026H2.md`, lines 268 and 280 (cut 5
  and its 2026-08-05 re-score). Read at CI-Engineering commit d068a20, unchanged on
  `main` d573ddc.
- CI-Marketplace `apps/ci-ha-voice/config.json` on `dev`, and CI-Server
  `backend/apps/api/src/domains/auth/services/ConnectService.ts` (the
  `ci-ha-voice` case).
