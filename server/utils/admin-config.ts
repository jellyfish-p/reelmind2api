import { writeFileSync, renameSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { dump as dumpYaml } from 'js-yaml'
import {
  getConfigPath,
  loadConfig,
  resetConfigCache,
  type ApiKeyConfig,
  type AppConfig,
  type DatabaseConfig,
  type PollingConfig,
  type ReelmindConfig,
} from './config'
import { maskSecret } from './admin-response'

export type SanitizedApiKeyConfig = Omit<ApiKeyConfig, 'key'> & {
  key: string | null
}

export type SanitizedAppConfig = Omit<AppConfig, 'admin_key' | 'api_keys'> & {
  admin_key: string | null
  api_keys: SanitizedApiKeyConfig[]
}

export type ConfigPatch = Partial<{
  server: Partial<AppConfig['server']>
  admin_key: AppConfig['admin_key']
  reelmind: Partial<ReelmindConfig>
  database: Partial<DatabaseConfig>
  polling: Partial<PollingConfig>
}>

type ApiKeyField = keyof ApiKeyConfig
type ApiKeyPatch = Partial<ApiKeyConfig>
type ApiKeyErrorCode =
  | 'invalid_api_key'
  | 'duplicate_api_key'
  | 'api_key_not_found'

export class ConfigPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigPatchError'
  }
}

export class ApiKeyConfigError extends Error {
  code: ApiKeyErrorCode
  status: number

  constructor(message: string, code: ApiKeyErrorCode, status: number) {
    super(message)
    this.name = 'ApiKeyConfigError'
    this.code = code
    this.status = status
  }
}

const SECTION_FIELDS = {
  server: ['port', 'host'],
  reelmind: ['api_base', 'web_base', 'google_client_id'],
  database: ['path'],
  polling: ['interval', 'max_retries', 'token_refresh_margin'],
} as const

const API_KEY_FIELDS = [
  'key',
  'name',
  'quota',
  'rate_limit',
  'enabled',
] as const satisfies readonly ApiKeyField[]

type SectionName = keyof typeof SECTION_FIELDS

const TOP_LEVEL_FIELDS = new Set([
  'server',
  'admin_key',
  'reelmind',
  'database',
  'polling',
])

const FIELD_VALIDATORS = {
  server: {
    port: (value: unknown) => normalizeInteger(value, 'server.port', 1, 65535),
    host: (value: unknown) => normalizeNonEmptyString(value, 'server.host'),
  },
  reelmind: {
    api_base: (value: unknown) => normalizeHttpUrl(value, 'reelmind.api_base'),
    web_base: (value: unknown) => normalizeHttpUrl(value, 'reelmind.web_base'),
    google_client_id: (value: unknown) =>
      normalizeString(value, 'reelmind.google_client_id'),
  },
  database: {
    path: (value: unknown) => normalizeNonEmptyString(value, 'database.path'),
  },
  polling: {
    interval: (value: unknown) => normalizeInteger(value, 'polling.interval', 1),
    max_retries: (value: unknown) => normalizeInteger(value, 'polling.max_retries', 1),
    token_refresh_margin: (value: unknown) =>
      normalizeInteger(value, 'polling.token_refresh_margin', 1),
  },
} as const

export function getSanitizedConfig(
  config = loadConfig(),
): SanitizedAppConfig {
  return {
    ...config,
    admin_key: maskSecret(config.admin_key),
    api_keys: sanitizeApiKeys(config.api_keys),
  }
}

export function sanitizeApiKeys(keys: ApiKeyConfig[] = []): SanitizedApiKeyConfig[] {
  return keys.map((apiKey) => ({
    ...apiKey,
    key: maskSecret(apiKey.key),
  }))
}

export function listApiKeys(): SanitizedApiKeyConfig[] {
  return sanitizeApiKeys(loadConfig().api_keys)
}

export function createApiKey(input: unknown): SanitizedApiKeyConfig {
  const apiKey = validateApiKeyInput(input)
  const nextConfig = cloneConfig(loadConfig())

  if (hasApiKey(nextConfig.api_keys, apiKey.key)) {
    throwDuplicateApiKey()
  }

  nextConfig.api_keys.push(apiKey)
  writeConfig(nextConfig)
  return sanitizeApiKeys([apiKey])[0]
}

export function updateApiKey(
  currentKey: string,
  patch: unknown,
): SanitizedApiKeyConfig {
  const apiKeyPatch = validateApiKeyPatch(patch)
  const nextConfig = cloneConfig(loadConfig())
  const index = nextConfig.api_keys.findIndex((apiKey) => apiKey.key === currentKey)

  if (index === -1) {
    throwApiKeyNotFound()
  }

  const replacementKey = apiKeyPatch.key
  if (
    replacementKey !== undefined &&
    replacementKey !== currentKey &&
    nextConfig.api_keys.some(
      (apiKey, apiKeyIndex) =>
        apiKeyIndex !== index && apiKey.key === replacementKey,
    )
  ) {
    throwDuplicateApiKey()
  }

  const updatedApiKey = {
    ...nextConfig.api_keys[index],
    ...apiKeyPatch,
  }
  nextConfig.api_keys[index] = updatedApiKey
  writeConfig(nextConfig)
  return sanitizeApiKeys([updatedApiKey])[0]
}

export function deleteApiKey(currentKey: string): { deleted: true } {
  const nextConfig = cloneConfig(loadConfig())
  const index = nextConfig.api_keys.findIndex((apiKey) => apiKey.key === currentKey)

  if (index === -1) {
    throwApiKeyNotFound()
  }

  nextConfig.api_keys.splice(index, 1)
  writeConfig(nextConfig)
  return { deleted: true }
}

export function patchConfig(patch: unknown): SanitizedAppConfig {
  const validatedPatch = validatePatch(patch)
  const nextConfig = cloneConfig(loadConfig())

  if (Object.prototype.hasOwnProperty.call(validatedPatch, 'admin_key')) {
    nextConfig.admin_key = validatedPatch.admin_key as AppConfig['admin_key']
  }

  for (const section of Object.keys(SECTION_FIELDS) as SectionName[]) {
    const sectionPatch = validatedPatch[section]
    if (sectionPatch === undefined) continue
    Object.assign(nextConfig[section], sectionPatch)
  }

  writeConfig(nextConfig)
  return getSanitizedConfig(nextConfig)
}

export function writeConfig(config: AppConfig) {
  const configPath = getConfigPath()
  const tempPath = join(
    dirname(configPath),
    `.config.yaml.${process.pid}.${Date.now()}.tmp`,
  )
  writeFileSync(tempPath, dumpYaml(config), { encoding: 'utf-8', mode: 0o600 })
  try {
    renameSync(tempPath, configPath)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      // Best effort cleanup; preserve the original persistence failure.
    }
    throw error
  }
  resetConfigCache()
}

export function isConfigPatchError(error: unknown): error is ConfigPatchError {
  return error instanceof ConfigPatchError
}

export function isApiKeyConfigError(error: unknown): error is ApiKeyConfigError {
  return error instanceof ApiKeyConfigError
}

function validatePatch(patch: unknown): ConfigPatch {
  if (!isPlainObject(patch)) {
    throw new ConfigPatchError('Invalid config patch')
  }

  const normalizedPatch: ConfigPatch = {}
  for (const field of Object.keys(patch)) {
    if (!TOP_LEVEL_FIELDS.has(field)) {
      throw new ConfigPatchError(`Unsupported config field: ${field}`)
    }

    if (field === 'admin_key') {
      normalizedPatch.admin_key = normalizeNonEmptyString(
        patch[field],
        'admin_key',
      )
      continue
    }

    const section = field as SectionName
    normalizedPatch[section] = validateSectionPatch(
      section,
      patch[field],
    ) as any
  }

  return normalizedPatch
}

function validateApiKeyInput(input: unknown): ApiKeyConfig {
  const apiKey = validateApiKeyFields(input)

  for (const field of API_KEY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(apiKey, field)) {
      throwInvalidApiKeyField(field)
    }
  }

  return apiKey as ApiKeyConfig
}

function validateApiKeyPatch(patch: unknown): ApiKeyPatch {
  return validateApiKeyFields(patch)
}

function validateApiKeyFields(value: unknown): ApiKeyPatch {
  if (!isPlainObject(value)) {
    throw new ApiKeyConfigError(
      'Invalid API key payload',
      'invalid_api_key',
      400,
    )
  }

  const allowedFields = new Set<string>(API_KEY_FIELDS)
  const normalized: Record<string, unknown> = {}
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new ApiKeyConfigError(
        `Unsupported API key field: ${field}`,
        'invalid_api_key',
        400,
      )
    }

    normalized[field] = normalizeApiKeyField(
      field as ApiKeyField,
      value[field],
    )
  }

  return normalized as ApiKeyPatch
}

function validateSectionPatch(
  section: SectionName,
  value: unknown,
): ConfigPatch[SectionName] {
  if (!isPlainObject(value)) {
    throw new ConfigPatchError(`Invalid config field: ${section}`)
  }

  const allowedFields = new Set<string>(SECTION_FIELDS[section])
  const validators = FIELD_VALIDATORS[section]
  const normalizedSection: Record<string, unknown> = {}
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new ConfigPatchError(`Unsupported config field: ${section}.${field}`)
    }

    const validator = validators[field as keyof typeof validators] as (
      value: unknown,
    ) => unknown
    normalizedSection[field] = validator(value[field])
  }

  return normalizedSection as ConfigPatch[SectionName]
}

function cloneConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    server: { ...config.server },
    api_keys: config.api_keys.map((apiKey) => ({ ...apiKey })),
    reelmind: { ...config.reelmind },
    database: { ...config.database },
    polling: { ...config.polling },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeApiKeyField(
  field: ApiKeyField,
  value: unknown,
): ApiKeyConfig[ApiKeyField] {
  switch (field) {
    case 'key':
    case 'name':
      return normalizeApiKeyString(value, field)
    case 'quota':
    case 'rate_limit':
      return normalizeApiKeyInteger(value, field)
    case 'enabled':
      return normalizeApiKeyBoolean(value, field)
  }
}

function normalizeApiKeyString(value: unknown, field: ApiKeyField): string {
  if (typeof value !== 'string') {
    throwInvalidApiKeyField(field)
  }

  const normalized = value.trim()
  if (!normalized) {
    throwInvalidApiKeyField(field)
  }
  return normalized
}

function normalizeApiKeyInteger(value: unknown, field: ApiKeyField): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throwInvalidApiKeyField(field)
  }
  return value
}

function normalizeApiKeyBoolean(value: unknown, field: ApiKeyField): boolean {
  if (typeof value !== 'boolean') {
    throwInvalidApiKeyField(field)
  }
  return value
}

function hasApiKey(apiKeys: ApiKeyConfig[], key: string): boolean {
  return apiKeys.some((apiKey) => apiKey.key === key)
}

function throwInvalidApiKeyField(field: ApiKeyField): never {
  throw new ApiKeyConfigError(
    `Invalid API key field: ${field}`,
    'invalid_api_key',
    400,
  )
}

function throwDuplicateApiKey(): never {
  throw new ApiKeyConfigError(
    'API key already exists',
    'duplicate_api_key',
    409,
  )
}

function throwApiKeyNotFound(): never {
  throw new ApiKeyConfigError(
    'API key not found',
    'api_key_not_found',
    404,
  )
}

function normalizeNonEmptyString(value: unknown, field: string): string {
  const normalized = normalizeString(value, field).trim()
  if (!normalized) throw new ConfigPatchError(`Invalid config field: ${field}`)
  return normalized
}

function normalizeString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ConfigPatchError(`Invalid config field: ${field}`)
  }
  return value.trim()
}

function normalizeHttpUrl(value: unknown, field: string): string {
  const normalized = normalizeNonEmptyString(value, field)
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new ConfigPatchError(`Invalid config field: ${field}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigPatchError(`Invalid config field: ${field}`)
  }
  return normalized
}

function normalizeInteger(
  value: unknown,
  field: string,
  min: number,
  max?: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ConfigPatchError(`Invalid config field: ${field}`)
  }
  if (value < min || (max !== undefined && value > max)) {
    throw new ConfigPatchError(`Invalid config field: ${field}`)
  }
  return value
}
