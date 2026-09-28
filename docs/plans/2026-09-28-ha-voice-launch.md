# Companion Voice for Home Assistant: launch plan

Date: 2026-09-28. Owner: Liam.

## Where things stand

| Piece | Pull request | State |
|---|---|---|
| Wyoming bridge, ci-server memory and speech, ha.ci.computer site, tests, workflows | companionintelligence/CI-Home-Assistant-Voice-PE#8 | Draft, all local checks green |
| Hub audio routes accept OpenAI multipart uploads | companionintelligence/CI-Hub#1643 | Draft, needs a full `ci-local` run |
| Memory-only connect key for `ci-ha-voice` | companionintelligence/CI-Server#2746 | Draft, needs the Jest suite run |
| Hub store listing `ci-ha-voice` (hidden) | companionintelligence/CI-Marketplace#1687 | Draft, all 23,749 catalog tests green |

## Launch checklist

In order. Each line is also a quick-add task (see the script at the end).

- [ ] Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets to CI-Home-Assistant-Voice-PE #companion-voice
- [ ] Confirm ha.ci.computer has no existing DNS record in the ci.computer zone #companion-voice
- [ ] Review and merge CI-Home-Assistant-Voice-PE#8, then check that ha.ci.computer is live #companion-voice
- [ ] Dispatch publish-images.yml and set both ci-ha-voice GHCR packages to public #companion-voice
- [ ] Run ci-local on CI-Hub#1643 and merge it #companion-voice
- [ ] Run the auth and web tests on CI-Server#2746 and merge it #companion-voice
- [ ] Pin image digests on CI-Marketplace#1687, unhide the listing and merge #companion-voice
- [ ] Test on real hardware: Wyoming integration on port 10700, Assist pipeline, Voice PE #companion-voice
- [ ] Add CI-Home-Assistant-Voice-PE to the ci-local runbook in CI-Local-CICD #companion-voice
- [ ] Write the launch post for ci.computer and the Home Assistant community forum #companion-voice #reach

## Decisions made

- **Wyoming over TCP, not WebSocket.** Home Assistant's Wyoming integration only speaks TCP, so the old bridge could not be added at all. The bridge now uses the official `wyoming` library.
- **Conversation agent first.** The fastest working setup keeps Home Assistant's own Whisper and Piper and uses Companion only for answers. Companion speech is optional.
- **Memory with the smallest key.** Voice gets the `memory` scope at `write`, the same shape as the Mentra bridge. It can recall and save, but it cannot delete.
- **Public site, private repo.** ha.ci.computer serves its own `compose.yml` that pulls published images, so nobody needs access to the repository.
- **Gated CI.** Following the org rule, hosted CI runs only on dispatch. The one exception is the site deploy, which takes about a minute.

## Blocked in the cloud session

- codeload.github.com and repo.yarnpkg.com are blocked by the session's egress policy, so the full CI-Hub and CI-Server suites were not run there. The new tests were run in isolation.
- The planning dashboard runs on your Mac over Tailscale, so this plan could not be posted to it directly.

## Load into Companion Planning

Run on your Mac. Set `CP_URL` to your dashboard (for example `http://localhost:3848`) and, in standalone mode, `CP_API_KEY`.

```bash
CP_URL=${CP_URL:-http://localhost:3848}
grep '^- \[ \] ' docs/plans/2026-09-28-ha-voice-launch.md | sed 's/^- \[ \] //' |
while IFS= read -r task; do
  jq -n --arg text "$task" '{text: $text}' |
    curl -fsS -X POST "$CP_URL/api/tasks/quick" \
      -H 'Content-Type: application/json' \
      ${CP_API_KEY:+-H "x-api-key: $CP_API_KEY"} \
      --data-binary @- >/dev/null && echo "added: $task"
done
```
