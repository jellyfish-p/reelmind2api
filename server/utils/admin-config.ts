import { writeFileSync, renameSync } from 'fs'
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
  writeFileSync(tempPath, dumpYaml(config), 'utf-8')
  renameSync(tempPath, configPath)
  resetConfigCache()
}

export function isConfigPatchError(error: unknown): error is ConfigPatchError {
  return error instanceof ConfigPatchError
}

function validatePatch(patch: unknown): ConfigPatch {
  if (!isPlainObject(patch)) {
    throw new ConfigPatchError('Invalid config patch')
  }

  for (const field of Object.keys(patch)) {
    if (!TOP_LEVEL_FIELDS.has(field)) {
      throw new ConfigPatchError(`Unsupported config field: ${field}`)
    }

    if (field === 'admin_key') continue
    validateSectionPatch(field as SectionName, patch[field])
  }

  return patch as ConfigPatch
}

function validateSectionPatch(section: SectionName, value: unknown) {
  if (!isPlainObject(value)) {
    throw new ConfigPatchError(`Invalid config field: ${section}`)
  }

  const allowedFields = new Set<string>(SECTION_FIELDS[section])
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new ConfigPatchError(`Unsupported config field: ${section}.${field}`)
    }
  }
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
