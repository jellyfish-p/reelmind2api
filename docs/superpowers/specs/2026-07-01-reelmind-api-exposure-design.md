# ReelMind API Exposure Design

## Goal

Repair the local Nuxt API proxy by using the captured ReelMind browser traffic and
current ReelMind frontend JavaScript as the source of truth. The proxy should expose
all relevant model, generation, pricing, and Lego endpoints that the existing JS
uses, and local API keys should be configured only through `config.yaml`.

## Scope

Expose and verify these local API groups:

- Models: list, detail by id, search, config, image-to-video shortcut.
- Generation: create video task, task detail, task price.
- Pricing: quote.
- Lego: models, image generation, task detail, queue info.
- OpenAI-compatible `/api/v1/images/*` and `/api/v1/videos/generations` should use
  the same inferred upstream task creation contract.

Membership, payment, coupon, feedback, workspace, and admin endpoints are out of
scope for this change because they are unrelated to the requested proxy surface and
would expose account-management behavior unnecessarily.

## Inferred Upstream Contracts

The ReelMind JS defines these relevant upstream endpoints:

- `GET /models`
- `GET /models/:id`
- `GET /models/search`
- `POST /models/config`
- `POST /generation/gen-video`
- `GET /generation/task/:id`
- `POST /generation/task/price`
- `POST /pricing/quote`
- `GET /lego/models`
- `POST /lego/gen-pic`
- `GET /lego/task/:id`
- `GET /lego/task/queue-info/:id`

The generation payload should use ReelMind's snake_case fields, including
`model_id`, `prompt`, `negative_prompt`, `gen_type`, `guidance_scale`, `duration`,
`ratio` or `aspect_ratio`, `resolution`, `generation_mode`, `refer_img_url`,
`reference_image_urls`, `video_url`, `video_urls`, `audio_urls`, `bgm`, and
`generate_audio` when present.

## Local API Design

Add or repair explicit Nuxt server routes rather than a broad passthrough. Explicit
routes make the public surface auditable and prevent unrelated ReelMind account,
membership, payment, or admin endpoints from being exposed accidentally.

Local routes should map as follows:

- `/api/models/list` -> `GET /models`
- `/api/models/:id` -> `GET /models/:id`
- `/api/models/search` -> `GET /models/search`
- `/api/models/config` -> `POST /models/config`
- `/api/models/image-to-video` -> `GET /models` with `type=image-to-video`
- `/api/models/lego` -> `GET /lego/models`
- `/api/generation/gen-video` -> `POST /generation/gen-video`
- `/api/generation/task/:id` -> `GET /generation/task/:id`
- `/api/generation/price` -> `POST /generation/task/price`
- `/api/pricing/quote` -> `POST /pricing/quote`
- `/api/lego/models` -> `GET /lego/models`
- `/api/lego/gen-pic` -> `POST /lego/gen-pic`
- `/api/lego/task/:id` -> `GET /lego/task/:id`
- `/api/lego/task/queue-info/:id` -> `GET /lego/task/queue-info/:id`

Existing `/api/v1` generation endpoints should keep their OpenAI-style responses,
but their upstream submission should call `/generation/gen-video` and send the
same snake_case generation payload. They should persist the returned upstream task
id from any of `task_id`, `taskId`, `task.id`, or `id`.

## API Key Configuration

`config.yaml` is the single source of truth for local API keys. Authentication
should:

- Read `Authorization: Bearer <key>` or `X-API-Key`.
- Validate the key directly against `config.api_keys`.
- Reject disabled keys.
- Enforce configured quota based on persisted task usage where possible.
- Avoid requiring a mirrored `api_tokens` database row before a key is accepted.

The database should continue to store task state and usage. The `api_tokens` table
may remain for compatibility, but startup should not sync config keys into it and
authentication should not depend on it.

## Error Handling

Upstream non-2xx responses should return a structured local error with the upstream
status and body text. Local auth failures should remain `401` with an
OpenAI-compatible error shape for `/api/v1` routes. Missing required fields should
return `400`.

## Testing

Use test-first changes for:

- Config-only API key authentication accepts enabled config keys without a database
  token row and rejects disabled or missing keys.
- Model detail and search routes forward to `/models/:id` and `/models/search`.
- Generation and Lego routes forward to the inferred upstream paths.
- `/api/v1/videos/generations` and `/api/v1/images/generations` build
  snake_case `/generation/gen-video` payloads.

Run type checking or build after implementation to catch route/import issues.
