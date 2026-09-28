# ha.ci.computer

The setup site for Companion Voice for Home Assistant. It is plain HTML, CSS and
JavaScript in `public/`, served by a Cloudflare Worker with static assets
(`ci-ha-voice-setup`) on the custom domain `ha.ci.computer`. There is no build
step.

| File | What it is |
|---|---|
| `public/index.html`, `styles.css`, `app.js` | The page |
| `public/config.js` | Pure setup logic (the `.env` generator, checker rules), tested with `node --test` |
| `public/compose.yml` | The compose file people download; kept in step with `../docker-compose.yml` by a test |
| `public/_headers` | Security headers and caching, applied by Cloudflare |
| `public/icon.svg`, `favicon.svg`, `og.png` | Brand art (the Voice PE puck) |
| `wrangler.toml` | Worker name, assets directory and the `ha.ci.computer` custom domain |

## Work on it locally

```bash
cd web
npm ci
npm test                 # generator logic, compose drift, page wiring
npx wrangler dev         # http://localhost:8787, serves public/ with _headers applied
```

## Deploy from your Mac (command line)

You need Node 20 or newer (`brew install node`) and a Cloudflare login that can
manage Workers on the Companion Intelligence account and the `ci.computer` zone.

```bash
git clone https://github.com/companionintelligence/CI-Home-Assistant-Voice-PE.git
cd CI-Home-Assistant-Voice-PE/web
npm ci
npm test

npx wrangler login       # opens the browser once; approve access
npx wrangler whoami      # confirm the right account is listed

npx wrangler deploy      # uploads public/ and attaches ha.ci.computer
curl -sI https://ha.ci.computer | head -1
```

If `whoami` lists more than one account, deploy with
`CLOUDFLARE_ACCOUNT_ID=<id> npx wrangler deploy`.

The first deploy creates the Worker and the custom domain, including its DNS
record and certificate. The certificate can take a few minutes. If Cloudflare
refuses the domain, `ha.ci.computer` already has a DNS record: delete that
record in the dashboard and deploy again.

## Deploy from the Cloudflare dashboard (web)

This connects the repository so every push to `main` deploys by itself, with no
tokens stored in GitHub.

1. Cloudflare dashboard, **Workers & Pages**, **Create**, **Import a repository**.
2. Authorize the Cloudflare GitHub app for `companionintelligence` and pick
   `CI-Home-Assistant-Voice-PE`.
3. Settings:
   - **Project name:** `ci-ha-voice-setup` (must match `name` in `wrangler.toml`)
   - **Production branch:** `main`
   - **Root directory:** `web`
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy`
4. **Save and deploy.** Wrangler reads `wrangler.toml` and attaches
   `ha.ci.computer`. You can confirm it under the Worker's **Settings**,
   **Domains & Routes**.
5. Optional: under **Settings**, **Build**, set a build watch path of `web/*` so
   changes elsewhere in the repository do not redeploy the site.

## Deploy from GitHub Actions

`.github/workflows/deploy-web.yml` deploys on every push to `main` that touches
`web/`. It needs two repository secrets:

```bash
gh secret set CLOUDFLARE_API_TOKEN  --repo companionintelligence/CI-Home-Assistant-Voice-PE
gh secret set CLOUDFLARE_ACCOUNT_ID --repo companionintelligence/CI-Home-Assistant-Voice-PE
gh workflow run deploy-web.yml --repo companionintelligence/CI-Home-Assistant-Voice-PE --ref main
```

Create the token in the Cloudflare dashboard under **Account API tokens**,
**Create Token**, template **Edit Cloudflare Workers**, with the account and the
`ci.computer` zone included. Without the secrets the workflow skips the deploy
with a notice, so it never fails when you use the dashboard route instead.

## Before people can follow the Docker path

`compose.yml` pulls `ghcr.io/companionintelligence/ci-ha-voice-server` and
`ci-ha-voice-bridge`. Publish them once and make them public:

```bash
gh workflow run publish-images.yml --repo companionintelligence/CI-Home-Assistant-Voice-PE --ref main
```

Then, for each package, open its **Package settings** on GitHub and set
**Change visibility** to public.
