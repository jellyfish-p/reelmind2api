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

export class ConfigPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigPatchError'
  }
}

const SECTION_FIELDS = {
  server: ['port', 'host'],
  reelmind: ['api_base', 'web_base', 'google_client_id'],
  database: ['path'],
  polling: ['interval', 'max_retries', 'token_refresh_margin'],
} as const

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
