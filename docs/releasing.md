# Releasing

How the two container images are published, how to undo a bad one, and which
Hub, CI-Server and facade releases the Home Assistant work depends on.
Naming: `ci-server/` is the voice facade (Node, OpenAI-compatible), CI-Server
(capitalized) is Companion Memory, CI-Hub is Companion Hub.

Parts marked **Proposed** belong to the integration rework in
[docs/plans/2026-09-29-ha-integration-rework.md](plans/2026-09-29-ha-integration-rework.md)
and are not decided. Everything else describes what `publish-images.yml` does now.

## What publishes what

`.github/workflows/publish-images.yml` builds `ci-ha-voice-server` (context
`ci-server/`) and `ci-ha-voice-bridge` (context `voice-bridge/`) for
linux/amd64 and linux/arm64 and pushes them to `ghcr.io/companionintelligence/`.

| Trigger | Tags pushed | Moves `latest` |
|---|---|---|
| Tag `v1.2.3` | `1.2.3`, `1.2`, `latest`, `sha-<short>` | yes |
| Tag `v1.2.3-rc.1` (has a hyphen) | `1.2.3-rc.1`, `sha-<short>` | no |
| `gh workflow run publish-images.yml --ref main` | `latest`, `sha-<short>` | yes |
| Dispatch on any other branch | `sha-<short>` | no |
| Dispatch with `-f dry_run=true` | none, nothing is pushed | no |

Checked in the registry on 2026-09-29: each image has exactly two tags,
`latest` and `sha-d5a7c86`, and both point at the same digest for each image
(server `sha256:25d41b99...`, bridge `sha256:b953a1ab...`). No `v*` tag exists
yet. Whether `metadata-action` also emits `1.2` for a prerelease tag stays
unverified until such a tag exists.

`frozen-surfaces.test.mjs` in `web/test` evaluates the two conditions behind
this table (the `latest` rule and the `push` input) for a tag push, a prerelease
tag, a branch and a dispatch, so they cannot drift silently.

## The risk: `latest` is what people pull

The compose file at https://ha.ci.computer/compose.yml pulls both images at
`:latest`. Any `v*` tag without a hyphen and any dispatch on `main` moves
`latest`, and the next `docker compose pull` on every self-hosted stack takes it.
Nothing else gates that move, so treat every publish from `main` as a release
to all of them.

Hub installs are not exposed to this. The `ci-ha-voice` listing in
CI-Marketplace (`apps/ci-ha-voice/docker-compose.json`, read in a local
CI-Marketplace clone on 2026-09-29) pins both images by `sha-d5a7c86` and
digest, so a new `latest` reaches Hub users only after someone changes and
merges the pins.

How many people pull `latest` is not known. GHCR package insights for both
packages would show it (open question 4 in the rework plan).

## Files pinned by hash

`contracts/frozen-surfaces.json` holds the sha256 of three files: `web/public/compose.yml`
(served live at https://ha.ci.computer/compose.yml), `docker-compose.yml` and `.env.example`.
`frozen-surfaces.test.mjs` hashes the raw bytes, so a changed default, image tag,
restart policy or comment, a trailing newline or CRLF line endings turn it red, not
only a renamed port or variable. Hosted CI runs on dispatch only, so this test is the
gate on those files.

To change one of them on purpose, run `sha256sum` on it and update its value under
`frozen_files.sha256` in the same pull request, and say why in the description. Any
change under `web/` deploys on merge to `main`, and `compose.yml` is what every
self-hoster pulls.

## Before you publish

1. Run `scripts/test-all.sh` on the commit you intend to release. It builds
   `ci-server/dist` and fails, instead of skipping, if the whole-stack test cannot run.
2. Dispatch a dry run (below) and read the two build logs.
3. Publish: tag `vX.Y.Z`, or dispatch on `main`.
4. If it is the first publish of a package, set its visibility to public in the
   organization's package settings, so compose and Hub can pull without a login.
5. Pull the new `latest` on a scratch machine and run the setup checker at
   https://ha.ci.computer against it.

## Dry run

```bash
gh workflow run publish-images.yml \
  --repo companionintelligence/CI-Home-Assistant-Voice-PE \
  --ref <branch> -f dry_run=true
```

Both images are built for both platforms and nothing is pushed. `dry_run` is a
boolean input with default `false`, so the documented command without `-f`
still publishes. A tag push always publishes.

Limits to know about:

- The login step still runs and the build still writes its GitHub Actions cache
  (scoped per image), so a dry run is not free of side effects, only of pushed tags.
- GitHub only dispatches a workflow file that exists on the default branch, so
  the `dry_run` input is usable after this change has merged to `main`.
- The first hosted dry run has not been done yet. It is one hosted run of cost.
  Until then, the workflow syntax is checked with `actionlint` and the logic by
  the frozen test, not by a real run.

## Rollback

`sha-d5a7c86` is the known good pair today: it is what the Hub listing pins and,
on 2026-09-29, the same digests as `latest`. After a later release has run in
production without trouble, add its `sha-<short>` tag here as the newer target
and update `rollback_tag` in `contracts/frozen-surfaces.json`.

**Self-hosted compose stack.** Pin both images to the sha tag in your copy of
`compose.yml`, then pull and restart:

```bash
sed -i \
  -e 's#\(ci-ha-voice-server\):latest#\1:sha-d5a7c86#' \
  -e 's#\(ci-ha-voice-bridge\):latest#\1:sha-d5a7c86#' compose.yml
docker compose -f compose.yml config --images   # both GHCR lines end in :sha-d5a7c86
docker compose -f compose.yml pull
docker compose -f compose.yml up -d
```

To follow `latest` again, edit the two lines back. Roll both images together,
because the bridge and the facade are released as a pair.

**Companion Hub.** Nothing to do while the listing keeps its pins.

**Repair `latest` itself.** So that new pulls stop receiving a bad image, point
`latest` back at the good digest for each image. This needs a token with
`write:packages` and has not been run yet, so try it on a scratch tag first:

```bash
docker buildx imagetools create \
  --tag ghcr.io/companionintelligence/ci-ha-voice-server:latest \
  ghcr.io/companionintelligence/ci-ha-voice-server:sha-d5a7c86
docker buildx imagetools create \
  --tag ghcr.io/companionintelligence/ci-ha-voice-bridge:latest \
  ghcr.io/companionintelligence/ci-ha-voice-bridge:sha-d5a7c86
```

Deleting a package version from the registry is not a rollback: stacks already
pinned to it would fail to pull. Do not delete `sha-d5a7c86`.

## Tag rules

- **Images** use `v*` tags: `v1.2.3` publishes `1.2.3`, `1.2`, `latest` and
  `sha-<short>`. A tag with a hyphen, such as `v1.2.3-rc.1`, is a prerelease and
  does not move `latest`. The trigger is `v*` and stays so.
- **Versions inside the images** are separate and not tied to the tag: the
  facade reports `1.1.0` (`ci-server/src/version.ts`, `ci-server/package.json`)
  and the Wyoming `Info` answer says `2.0.0` (`voice-bridge/src/wyoming/info.py`).
- **Proposed:** the Home Assistant integration, once it exists, uses bare
  `X.Y.Z` tags with no `v`, so they never match `v*` and never start an image
  publish. If HACS refuses bare tags, the image trigger would be split to
  `voice-v*` (this touches README line 201, both workflow headers and the
  frozen test). No `v*` tag exists yet, so the split stays cheap until one does.

## Minimum releases

Checked on 2026-09-29 through GitHub tags and commit dates (the local Hub clone
is shallow and has no tags). Hub v0.2.77 was published at 07:38 UTC that day, after
the first check, so the multipart row and the CI-Server rows were checked again
afterwards. The other rows carry the first check. To be re-checked when the pull
request for this work is opened (Hub and CI-Server tags move daily), before the
integration agent ships, and whenever a Hub or CI-Server release changes one of
these routes. The last column is the **Proposed** behaviour of the integration,
which does not exist yet.

| Dependency | Route or feature | First release | Evidence | On an older release the integration |
|---|---|---|---|---|
| CI-Hub | `GET /api/inference/pool/identify` | between v0.2.61 and v0.2.70 (controller file absent at v0.2.60, present at v0.2.70) | tag file checks | refuses with `not_a_hub` |
| CI-Hub | key access to inference (`inference` scope, 401 codes, `WWW-Authenticate`) | v0.2.73 | guard file absent at v0.2.72, present at v0.2.73 (commit 16ea425, 2026-09-19) | needs no key on private addresses, cannot reach public ones |
| CI-Hub | `GET /api/hub/build` | v0.2.74 | route file absent at v0.2.73, present at v0.2.74 (commit 67d1e12, 2026-09-21) | Hub version sensor reads unknown |
| CI-Hub | multipart audio uploads (Later tier, Hub speech) | v0.2.77 (published 2026-09-29): its release notes list PR 1643, commit affad01 (2026-09-28), which is newer than v0.2.76 (2026-09-25) | release notes and commit list at tag v0.2.77 | on a Hub older than v0.2.77 the Hub speech entities stay Later; on v0.2.77 or newer the gate is a product decision, not a missing release |
| CI-Hub | `GET /api/health/live`, the fields of `GET /api/inference/health`, streaming chat | unchecked per route (the listing's `min_hub_version` v0.2.41 covers the store app only) | none | treats missing fields as unknown |
| CI-Server | the four memory routes and `/memory/turn` skipping system-role messages | v2026.9.23.1 at the latest: MemoryController.ts has the same last-touch commit (3b6295f) at v2026.9.23.1 and v2026.9.28.1, and no commit between v2026.9.28.1 and v2026.9.28.3 touches it. Nothing older was checked. | commit lists at the tags, and `git log` between v2026.9.28.1 and v2026.9.28.3 in a local clone | not supported |
| CI-Server | capability enforcement on every key route (#2736) | v2026.9.28.1 (the tested floor). v2026.9.28.2 and v2026.9.28.3 also exist and descend from it, but were not tested. | commit de7bea1 (#2736) is an ancestor of all three 2026.9.28 tags (`git merge-base --is-ancestor` in a local clone) | not supported |
| Facade (this repo) | `/health`, `/v1/status` with `version`, `default_model`, `llm`, `stt`, `tts`, `memory` | every published image: only `latest` and `sha-d5a7c86` exist, and `/v1/status` (commit acb5e45) predates the build at d5a7c86 | git log, GHCR tag list | reads missing fields as unknown |

The recommended floor is Hub v0.2.74 for the full sensor set and CI-Server
v2026.9.28.1. Hub v0.2.73 is enough for chat with a key. A Hub older than
v0.2.73 on the home network is expected to work without a key (its `/v1` routes
then carried only the internal-origin check, per the description of commit
16ea425), but that path was not exercised.

Release notes for the integration will live in `CHANGELOG.md` at the repository
root (**Proposed**). A release pull request would bump the manifest `version`,
the changelog and this table together.
