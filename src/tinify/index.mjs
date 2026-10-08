/**
 * tinify/index.mjs
 *
 * Unified entry point for all Tinify API operations.
 * Import from here instead of individual files.
 *
 * Usage:
 *   import { convertToWebp, resizeImage, TINIFY_SUPPORTED, resolveApiKeys, createKeyPool, isQuotaError } from './tinify/index.mjs'
 */

export { convertToWebp } from './webp.mjs'
export { resizeImage } from './resize.mjs'
export { compressFile, compressBuffer, compressFromUrl } from './compress.mjs'

// Formats supported by the Tinify API
export const TINIFY_SUPPORTED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif'])

// AccountError messages that indicate monthly quota exhaustion
const QUOTA_PATTERNS = ['too many', 'compression limit', 'limit has been exceeded']

export function isQuotaError(err) {
  const msg = (err?.message ?? '').toLowerCase()
  return err?.name === 'AccountError' && QUOTA_PATTERNS.some(p => msg.includes(p))
}

/**
 * Resolve API keys from CLI argument or environment variables.
 * Priority: cliKeys > TINIFY_API_KEYS > TINIFY_API_KEY
 *
 * @param {string[]} cliKeys - keys parsed from --api-key (may be empty)
 * @returns {string[]} non-empty array of keys
 * @throws if no keys can be resolved
 */
export function resolveApiKeys(cliKeys = []) {
  if (cliKeys.length > 0) return cliKeys

  const envKeys = process.env.TINIFY_API_KEYS
  const envKey  = process.env.TINIFY_API_KEY

  if (envKeys) return envKeys.split(',').map(k => k.trim()).filter(Boolean)
  if (envKey)  return [envKey.trim()]

  throw new Error(
    'Tinify engine requires --api-key <key[,key2,...]> or TINIFY_API_KEYS / TINIFY_API_KEY env variable.\n' +
    'Get a free API key at https://tinify.com/developers'
  )
}

/**
 * Initialize a key pool with the first key active.
 *
 * @param {string[]} keys
 * @returns {Promise<{ tinify: object, keys: string[], index: number }>}
 */
export async function createKeyPool(keys) {
  const { default: tinify } = await import('tinify')
  tinify.key = keys[0]
  return { tinify, keys, index: 0 }
}

/**
 * Switch to the next key in the pool when quota is exhausted.
 * Throws if all keys are exhausted.
 *
 * @param {{ tinify: object, keys: string[], index: number }} keyPool
 * @param {Error} err - the quota error that triggered the switch
 */
export function rotateKey(keyPool, err) {
  console.warn(`WARN key[${keyPool.index + 1}/${keyPool.keys.length}] quota exhausted: ${err.message}`)
  keyPool.index += 1
  if (keyPool.index >= keyPool.keys.length) {
    throw new Error('All Tinify API keys have exhausted their monthly quota.')
  }
  keyPool.tinify.key = keyPool.keys[keyPool.index]
  console.warn(`INFO switching to key[${keyPool.index + 1}/${keyPool.keys.length}]`)
}

/**
 * Print compression count summary after a batch run.
 *
 * @param {{ tinify: object }} keyPool
 */
export function printCompressionCount(keyPool) {
  const used = keyPool.tinify.compressionCount ?? 'unknown'
  console.log(`\ntinify compressions used this month (current key): ${used}`)
}
