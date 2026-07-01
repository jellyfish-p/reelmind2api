import { existsSync, readFileSync } from 'fs'
import { load as loadYaml } from 'js-yaml'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

export interface ApiKeyConfig {
  key: string
  name: string
  quota: number
  rate_limit: number
  enabled: boolean
}

export interface ReelmindConfig {
  api_base: string
  web_base: string
  google_client_id: string
}

export interface DatabaseConfig {
  path: string
}

export interface PollingConfig {
  interval: number
  max_retries: number
  token_refresh_margin: number
}

export interface AppConfig {
  server: { port: number; host: string }
  admin_key: string
  api_keys: ApiKeyConfig[]
  reelmind: ReelmindConfig
  database: DatabaseConfig
  polling: PollingConfig
}

let _config: AppConfig | null = null

export function getConfigPath(): string {
  const cwd = process.cwd()
  const paths = [
    resolve(cwd, 'config.yaml'),
    resolve(cwd, 'config.yml'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../config.yaml'),
  ]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return resolve(cwd, 'config.yaml')
}

export function loadConfig(): AppConfig {
  if (_config) return _config
  const configPath = getConfigPath()
  const raw = readFileSync(configPath, 'utf-8')
  _config = loadYaml(raw) as AppConfig
  return _config
}

export function resetConfigCache() {
  _config = null
}

export function findApiKey(key: string): ApiKeyConfig | undefined {
  const config = loadConfig()
  return config.api_keys.find(
    (k) => k.key === key && k.enabled !== false,
  )
}

export function validateAdminKey(key: string): boolean {
  const config = loadConfig()
  const presentedKey = typeof key === 'string' ? key : ''
  const storedKey = typeof config.admin_key === 'string' ? config.admin_key : ''
  return Boolean(
    presentedKey.trim() &&
      storedKey.trim() &&
      presentedKey === storedKey,
  )
}
