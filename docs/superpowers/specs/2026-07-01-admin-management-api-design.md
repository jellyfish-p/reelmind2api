# Admin Management API Design

## Goal

Add a backend admin API surface that the frontend can use to manage local
configuration, API keys, the ReelMind token pool, generation task logs, and
operational summary data.

The API should be explicit and auditable. It should not expose broad filesystem
or database access to the browser.

## Scope

In scope:

- Read and update selected `config.yaml` fields.
- Manage `config.yaml` API keys.
- Manage the `accounts` database table as the ReelMind token pool.
- Read generation task logs from the `tasks` database table.
- Read aggregate admin statistics.
- Reuse the existing admin authentication helper.

Out of scope:

- A raw YAML editor endpoint.
- Browser-visible full token or key disclosure in read responses.
- User-facing admin UI layout.
- Upstream ReelMind account creation or Google OAuth login flow.
- Deleting historical task logs automatically when deleting an account.

## Authentication

Every route under `/api/admin/**` must require admin authentication through the
existing `authenticateAdmin(event)` helper.

Accepted credentials:

- `X-Admin-Key: <admin_key>`
- `?admin_key=<admin_key>`

Unauthorized requests return `401` with a structured JSON error.

## Config Management

Add a config writer utility that can safely update `config.yaml`.

The utility should:

- Load the existing YAML config.
- Validate the requested structured update.
- Merge only allowed fields.
- Write to a temporary file in the same directory.
- Replace the original file after the temporary write succeeds.
- Call `resetConfigCache()` after a successful write.

Allowed config update fields:

- `server.port`
- `server.host`
- `admin_key`
- `reelmind.api_base`
- `reelmind.web_base`
- `reelmind.google_client_id`
- `database.path`
- `polling.interval`
- `polling.max_retries`
- `polling.token_refresh_margin`

The read endpoint returns a sanitized config object. Sensitive fields are masked
instead of returned in full:

- `admin_key`
- `api_keys[].key`

### Routes

- `GET /api/admin/config`
  - Returns sanitized config.

- `PATCH /api/admin/config`
  - Accepts a partial structured config object.
  - Updates only allowed non-`api_keys` config fields.
  - Returns sanitized updated config.

## API Key Management

API keys remain stored in `config.yaml` as the source of truth.

Routes:

- `GET /api/admin/api-keys`
  - Returns sanitized API key entries.
  - Includes `name`, `quota`, `rate_limit`, `enabled`, and masked key.

- `POST /api/admin/api-keys`
  - Creates a key entry with `key`, `name`, `quota`, `rate_limit`, `enabled`.
  - Rejects duplicate keys.
  - Returns the sanitized created entry.

- `PATCH /api/admin/api-keys/:key`
  - Updates `name`, `quota`, `rate_limit`, `enabled`, and optionally replaces
    `key`.
  - Uses the path key as the identifier.
  - Returns the sanitized updated entry.

- `DELETE /api/admin/api-keys/:key`
  - Removes the key from `config.yaml`.
  - Does not remove existing `api_tokens` usage rows.

## Token Pool Management

The token pool is the `accounts` table.

Read responses must not return full `access_token` or `refresh_token`. Instead,
they return:

- `hasAccessToken`
- `accessTokenPreview`
- `hasRefreshToken`
- `refreshTokenPreview`
- `tokenExpiresAt`
- `tokenExpired`

Routes:

- `GET /api/admin/accounts`
  - Returns accounts with token previews and basic task counts.

- `POST /api/admin/accounts`
  - Creates an account.
  - Required: `email`.
  - Optional: `name`, `googleSub`, `accessToken`, `refreshToken`,
    `tokenExpiresAt`.

- `GET /api/admin/accounts/:id`
  - Returns one sanitized account plus task summary.

- `PATCH /api/admin/accounts/:id`
  - Updates account metadata and tokens.
  - Supports clearing tokens by passing `null`.

- `DELETE /api/admin/accounts/:id`
  - Deletes the account row.
  - Historical tasks are retained. If foreign key constraints prevent deletion,
    the route should detach those tasks by setting `account_id` to `null`, then
    delete the account.

## Generation Task Logs

Task log routes read from the existing `tasks` table. They are intended for
frontend filtering, inspection, and dashboard views.

Routes:

- `GET /api/admin/tasks`
  - Supports pagination with `page` and `limit`.
  - Supports filters: `status`, `type`, `model`, `account_id`, `api_token_id`,
    `created_from`, `created_to`.
  - Returns summarized task rows and pagination metadata.

- `GET /api/admin/tasks/:id`
  - Accepts local numeric `id` or public `task_id`.
  - Returns full task details, including `parameters`, `result_data`,
    `error_message`, and upstream task id.

Read responses may include prompts and result data because this is an admin API.
They should not include account tokens.

## Admin Stats

Add a lightweight stats endpoint for dashboard cards.

Route:

- `GET /api/admin/stats`
  - Returns:
    - task totals by status
    - task totals by type
    - recent task count
    - total credits used
    - account count
    - expired token count
    - API key count

## Error Handling

All admin routes return JSON errors:

```json
{
  "error": {
    "message": "Human-readable message",
    "code": "admin_error_code"
  }
}
```

Recommended status codes:

- `400` for invalid input.
- `401` for missing or invalid admin key.
- `404` for missing account, API key, or task.
- `409` for duplicate API keys or duplicate accounts.
- `500` for unexpected persistence failures.

## Testing

Add tests before implementation for:

- Admin auth blocks requests without a valid admin key.
- Config read masks `admin_key` and API keys.
- Config patch writes allowed fields and rejects unknown fields.
- API key create, update, delete modify `config.yaml` through the utility.
- Account list and detail mask tokens.
- Account create, update, delete affect the `accounts` table.
- Task list filters and paginates results.
- Task detail accepts both local `id` and public `task_id`.
- Stats aggregates task and account data.

Run the full Vitest suite and Nuxt build after implementation.
