# ReelMind2API

OpenAI-compatible API proxy for ReelMind generation endpoints, with an admin
console, API key quota tracking, SQLite task storage, token refresh, task
polling, and account-pool scheduling by remaining credits.

## Features

- OpenAI-style image and video generation routes under `/api/v1`.
- Admin console at `/admin` for API keys, accounts, tasks, and configuration.
- SQLite-backed task history and account token pool.
- Automatic account rotation based on token validity and `creditsRemaining`.
- Cost-aware scheduling: image requests reserve 5 credits; video requests
  reserve 10 credits per second, defaulting to 1 second when duration is absent.
- Background polling for upstream task status and token refresh.
- Docker image published automatically to GitHub Container Registry.

## Requirements

- Node.js 22+
- npm
- Docker, for container deployment

## Configuration

Runtime configuration is stored in `config.yaml`.

Important fields:

- `admin_key`: password for the `/admin` console.
- `api_keys`: client-facing API keys, quotas, and rate limits.
- `reelmind.api_base`: upstream ReelMind API base URL.
- `reelmind.web_base`: upstream ReelMind web base URL used as `Referer`.
- `polling`: task polling and token refresh settings.

Before deploying, copy or edit `config.yaml` and replace the default secrets:

```yaml
admin_key: "change-me"

api_keys:
  - key: "sk-your-client-key"
    name: "default"
    quota: 10000
    rate_limit: 60
    enabled: true
```

The SQLite database is stored in `./data/reelmind.db` locally and `/app/data`
inside the Docker image.

## Local Development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open:

- App/API: `http://localhost:3000`
- Admin console: `http://localhost:3000/admin`

Run tests:

```bash
npm run test:run
```

Build for production:

```bash
npm run build
```

## API Usage

Authenticate client requests with either `Authorization: Bearer <api-key>` or
`X-API-Key: <api-key>`.

Video generation:

```bash
curl -X POST http://localhost:3000/api/v1/videos/generations \
  -H "Authorization: Bearer sk-your-client-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "reelmind-video",
    "prompt": "a cinematic city sunrise",
    "duration": 5,
    "aspect_ratio": "16:9",
    "resolution": "1080p"
  }'
```

Image generation:

```bash
curl -X POST http://localhost:3000/api/v1/images/generations \
  -H "Authorization: Bearer sk-your-client-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "reelmind-image",
    "prompt": "a ceramic lamp on a desk",
    "size": "1024x1024"
  }'
```

## Account Pool

Add ReelMind accounts in the admin console. Each account can store Supabase auth
cookie parts or a bearer token, plus an optional `Credits Remaining` value.

An account is eligible for generation when:

- it has an access token,
- the token is not expired, and
- `creditsRemaining` is either unknown or high enough for the request.

When `creditsRemaining` is known, the scheduler pre-reserves credits before
submitting upstream. If upstream submission fails, the reservation is refunded.

## Docker Deployment

The project includes a production Dockerfile. The container listens on port
`3000` and persists SQLite data under `/app/data`.

### GHCR Image

GitHub Actions publishes images to GitHub Container Registry:

```text
ghcr.io/jellyfish-p/reelmind2api
```

Workflow behavior:

- Push to `main`: publishes `latest` and `main-<sha>` tags.
- Push tag `v*.*.*`: publishes semver tags, for example `1.2.3` and `1.2`.
- Pull requests: build only, no push.
- Manual dispatch: available from GitHub Actions.

Pull the latest image:

```bash
docker pull ghcr.io/jellyfish-p/reelmind2api:latest
```

If the package is private, log in first with a GitHub token that can read
packages:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

### docker run

Linux/macOS:

```bash
mkdir -p data

docker run -d \
  --name reelmind2api \
  --restart unless-stopped \
  -p 3000:3000 \
  -v "$(pwd)/config.yaml:/app/config.yaml:ro" \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/jellyfish-p/reelmind2api:latest
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force data

docker run -d `
  --name reelmind2api `
  --restart unless-stopped `
  -p 3000:3000 `
  -v "${PWD}\config.yaml:/app/config.yaml:ro" `
  -v "${PWD}\data:/app/data" `
  ghcr.io/jellyfish-p/reelmind2api:latest
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
services:
  reelmind2api:
    image: ghcr.io/jellyfish-p/reelmind2api:latest
    container_name: reelmind2api
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./data:/app/data
```

Start:

```bash
docker compose up -d
```

Update to the newest GHCR image:

```bash
docker compose pull
docker compose up -d
```

View logs:

```bash
docker logs -f reelmind2api
```

## Local Docker Build

Build and run without GHCR:

```bash
docker build -t reelmind2api:local .

docker run -d \
  --name reelmind2api \
  -p 3000:3000 \
  -v "$(pwd)/config.yaml:/app/config.yaml:ro" \
  -v "$(pwd)/data:/app/data" \
  reelmind2api:local
```

## GitHub Container Workflow

The workflow lives at `.github/workflows/docker.yml`.

It uses:

- `docker/metadata-action` for GHCR tags and labels.
- `docker/build-push-action` with GitHub Actions cache.
- `GITHUB_TOKEN` for package publishing on non-PR events.

No extra registry secret is required for the default GHCR publish path.
