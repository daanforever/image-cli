#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { resizeImage, TINIFY_SUPPORTED, resolveApiKeys, createKeyPool, isQuotaError, rotateKey, printCompressionCount } from './tinify/index.mjs'

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.tiff', '.tif'])
const SUPPORTED_FORMATS = new Set(['keep', 'png', 'jpeg', 'webp'])
const SUPPORTED_FITS = new Set(['inside', 'outside', 'fill', 'contain'])
const TINIFY_METHODS = new Set(['scale', 'fit', 'cover', 'thumb'])

function printUsage() {
  console.log(`Usage:
  image-cli resize <file-or-dir> [--width <n>] [--height <n>] [--api-key key1,...] [--method scale|fit|cover|thumb] [--recursive] [--replace] [--output-dir <dir>] [--skip-larger] [--dry-run]
  image-cli resize <file-or-dir> --engine local [--width <n>] [--height <n>] [--max-side <n>] [--fit inside|outside|fill|contain] [--without-enlargement] [--format keep|png|jpeg|webp] [--recursive] [--replace] [--output-dir <dir>] [--dry-run]

Engines:
  tinify  (default) Cloud resize via TinyPNG API. Intelligent cropping with cover/thumb methods.
          Free tier: 500 compressions/month per key. Each file = 2 compressions (shrink + resize).
          Supports a key pool: --api-key key1,key2,key3
          Also reads TINIFY_API_KEYS or TINIFY_API_KEY env vars.
  local   Local resize via sharp. No API needed. More format/fit options.`)
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }
  return parsed
}

function parseArgs(argv) {
  const options = {
    inputPath: '',
    engine: 'tinify',
    apiKeys: [],
    method: 'fit',
    width: null,
    height: null,
    maxSide: null,
    recursive: false,
    replace: false,
    outputDir: '',
    fit: 'inside',
    withoutEnlargement: false,
    format: 'keep',
    skipLarger: false,
    dryRun: false,
  }

  const args = [...argv]
  options.inputPath = args.shift() ?? ''

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--recursive') { options.recursive = true; continue }
    if (arg === '--replace') { options.replace = true; continue }
    if (arg === '--without-enlargement') { options.withoutEnlargement = true; continue }
    if (arg === '--skip-larger') { options.skipLarger = true; continue }
    if (arg === '--dry-run') { options.dryRun = true; continue }

    if (arg === '--engine') {
      const value = args.shift()
      if (value !== 'local' && value !== 'tinify') throw new Error('--engine must be local or tinify')
      options.engine = value
      continue
    }

    if (arg === '--api-key') {
      const value = args.shift()
      if (!value) throw new Error('--api-key requires a value')
      options.apiKeys = value.split(',').map(k => k.trim()).filter(Boolean)
      continue
    }

    if (arg === '--method') {
      const value = args.shift()
      if (!TINIFY_METHODS.has(value)) throw new Error('--method must be one of scale, fit, cover, thumb')
      options.method = value
      continue
    }

    if (arg === '--width') { options.width = parsePositiveInteger(args.shift(), '--width'); continue }
    if (arg === '--height') { options.height = parsePositiveInteger(args.shift(), '--height'); continue }
    if (arg === '--max-side') { options.maxSide = parsePositiveInteger(args.shift(), '--max-side'); continue }

    if (arg === '--output-dir') {
      const value = args.shift()
      if (!value) throw new Error('--output-dir requires a directory path')
      options.outputDir = value
      continue
    }

    if (arg === '--fit') {
      const value = args.shift()
      if (!SUPPORTED_FITS.has(value)) throw new Error('--fit must be one of inside, outside, fill, contain')
      options.fit = value
      continue
    }

    if (arg === '--format') {
      const value = args.shift()
      if (!SUPPORTED_FORMATS.has(value)) throw new Error('--format must be one of keep, png, jpeg, webp')
      options.format = value
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!options.inputPath) throw new Error('Missing <file-or-dir>')

  if (options.engine === 'tinify') {
    options.apiKeys = resolveApiKeys(options.apiKeys)
    if (options.width === null && options.height === null) {
      throw new Error('tinify engine requires --width and/or --height (scale: one of them; fit/cover/thumb: both)')
    }
    if ((options.method === 'fit' || options.method === 'cover' || options.method === 'thumb') && (options.width === null || options.height === null)) {
      throw new Error(`--method ${options.method} requires both --width and --height`)
    }
    if (options.method === 'scale' && options.width !== null && options.height !== null) {
      throw new Error('--method scale requires only one of --width or --height, not both')
    }
  } else {
    if (options.width === null && options.height === null && options.maxSide === null) {
      throw new Error('At least one of --width, --height, or --max-side is required')
    }
  }

  return options
}

async function collectFiles(targetPath, recursive) {
  const stat = await fs.stat(targetPath)
  if (stat.isFile()) {
    return [targetPath]
  }

  if (!stat.isDirectory()) {
    return []
  }

  const results = []
  const entries = await fs.readdir(targetPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name)
    if (entry.isFile()) {
      results.push(fullPath)
      continue
    }
    if (entry.isDirectory() && recursive) {
      results.push(...await collectFiles(fullPath, true))
    }
  }

  return results
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// keyPool: { tinify, keys: string[], index: number }
async function resizeFileTinify(keyPool, filePath, options, rootInputPath, stats) {
  const ext = path.extname(filePath).toLowerCase()

  if (!TINIFY_SUPPORTED.has(ext)) {
    stats.skipped += 1
    console.log(`SKIPPED ${filePath} unsupported format for tinify engine`)
    return
  }

  const parsed = path.parse(filePath)
  const relativeDir = path.relative(rootInputPath, parsed.dir)
  const normalizedRelativeDir = relativeDir === '.' ? '' : relativeDir
  const outputPath = options.outputDir
    ? path.join(options.outputDir, normalizedRelativeDir, `${parsed.name}${parsed.ext}`)
    : path.join(parsed.dir, `${parsed.name}.resized${parsed.ext}`)

  const sourceSize = (await fs.stat(filePath)).size

  if (options.dryRun) {
    stats.previewed += 1
    const dim = options.width && options.height ? `${options.width}x${options.height}` : (options.width ? `w${options.width}` : `h${options.height}`)
    console.log(`DRY-RUN ${filePath} -> ${outputPath} (tinify ${options.method} ${dim})`)
    return
  }

  await ensureDirectoryForFile(outputPath)

  const resizeParams = { method: options.method }
  if (options.width !== null) resizeParams.width = options.width
  if (options.height !== null) resizeParams.height = options.height

  while (true) {
    try {
      const { tinify } = keyPool
      await resizeImage(tinify, filePath, outputPath, resizeParams)

      const outputSize = (await fs.stat(outputPath)).size

      if (options.skipLarger && outputSize >= sourceSize) {
        await fs.unlink(outputPath)
        stats.skipped += 1
        console.log(`SKIPPED ${filePath} output larger (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)})`)
        return
      }

      if (options.replace && path.resolve(outputPath) !== path.resolve(filePath)) {
        await fs.unlink(filePath)
      }

      stats.resized += 1
      stats.sourceBytes += sourceSize
      stats.outputBytes += outputSize
      const keyLabel = `key[${keyPool.index + 1}/${keyPool.keys.length}]`
      console.log(`RESIZED ${filePath} -> ${outputPath} (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)}) [tinify ${options.method} ${keyLabel}, used: ${tinify.compressionCount}]`)
      return
    } catch (err) {
      if (isQuotaError(err)) {
        rotateKey(keyPool, err)
      } else {
        throw err
      }
    }
  }
}

function getOriginalFormat(ext) {
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'jpeg'
  }
  if (ext === '.tif' || ext === '.tiff') {
    return 'png'
  }
  return ext.slice(1)
}

function getTargetFormat(ext, requestedFormat) {
  if (requestedFormat !== 'keep') {
    return requestedFormat
  }
  const originalFormat = getOriginalFormat(ext)
  if (SUPPORTED_FORMATS.has(originalFormat)) {
    return originalFormat
  }
  return 'png'
}

function getOutputExtension(format) {
  if (format === 'jpeg') {
    return '.jpg'
  }
  return `.${format}`
}

function getOutputPath(filePath, rootInputPath, outputDir, replace, targetFormat) {
  const parsed = path.parse(filePath)
  const relativeDir = path.relative(rootInputPath, parsed.dir)
  const normalizedRelativeDir = relativeDir === '.' ? '' : relativeDir
  const outputExtension = getOutputExtension(targetFormat)

  if (replace && !outputDir) {
    if (outputExtension === parsed.ext.toLowerCase()) {
      return filePath
    }
    return path.join(parsed.dir, `${parsed.name}${outputExtension}`)
  }

  if (!outputDir) {
    return path.join(parsed.dir, `${parsed.name}.resized${outputExtension}`)
  }

  return path.join(outputDir, normalizedRelativeDir, `${parsed.name}${outputExtension}`)
}

async function ensureDirectoryForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

function buildResizeOptions(metadata, options) {
  if (options.maxSide !== null) {
    const width = metadata.width ?? null
    const height = metadata.height ?? null

    if (width !== null && height !== null) {
      if (width >= height) {
        return { width: options.maxSide, height: null }
      }
      return { width: null, height: options.maxSide }
    }
  }

  return {
    width: options.width,
    height: options.height,
  }
}

function applyFormat(pipeline, targetFormat) {
  if (targetFormat === 'png') {
    return pipeline.png()
  }
  if (targetFormat === 'jpeg') {
    return pipeline.jpeg({ quality: 95, mozjpeg: true })
  }
  if (targetFormat === 'webp') {
    return pipeline.webp({ quality: 95 })
  }
  return pipeline
}

async function resizeFile(filePath, options, rootInputPath, stats) {
  const ext = path.extname(filePath).toLowerCase()

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    stats.skipped += 1
    console.log(`SKIPPED ${filePath} unsupported format`)
    return
  }

  const sourceBuffer = await fs.readFile(filePath)
  const sourceSize = sourceBuffer.byteLength
  const image = sharp(sourceBuffer, { animated: true }).withMetadata()
  const metadata = await image.metadata()
  const resizeOptions = buildResizeOptions(metadata, options)
  const targetFormat = getTargetFormat(ext, options.format)

  let pipeline = sharp(sourceBuffer, { animated: true }).withMetadata().resize({
    width: resizeOptions.width,
    height: resizeOptions.height,
    fit: options.fit,
    withoutEnlargement: options.withoutEnlargement,
  })

  pipeline = applyFormat(pipeline, targetFormat)

  const outputBuffer = await pipeline.toBuffer()
  const outputPath = getOutputPath(filePath, rootInputPath, options.outputDir, options.replace, targetFormat)
  const outputSize = outputBuffer.byteLength

  if (options.dryRun) {
    stats.previewed += 1
    console.log(`DRY-RUN ${filePath} -> ${outputPath} (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)})`)
    return
  }

  await ensureDirectoryForFile(outputPath)
  await fs.writeFile(outputPath, outputBuffer)

  if (options.replace && path.resolve(outputPath) !== path.resolve(filePath)) {
    await fs.unlink(filePath)
  }

  stats.resized += 1
  console.log(`RESIZED ${filePath} -> ${outputPath} (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)})`)
}

async function main(argv) {
  try {
    const options = parseArgs(argv)
    const absoluteInputPath = path.resolve(options.inputPath)
    const inputStat = await fs.stat(absoluteInputPath)
    const rootInputPath = inputStat.isDirectory() ? absoluteInputPath : path.dirname(absoluteInputPath)
    const files = await collectFiles(absoluteInputPath, options.recursive)

    const stats = {
      resized: 0,
      skipped: 0,
      previewed: 0,
      errors: 0,
      sourceBytes: 0,
      outputBytes: 0,
    }

    if (options.engine === 'tinify') {
      const keyPool = await createKeyPool(options.apiKeys)

      for (const filePath of files) {
        try {
          await resizeFileTinify(keyPool, filePath, options, rootInputPath, stats)
        } catch (error) {
          stats.errors += 1
          const message = error instanceof Error ? error.message : String(error)
          console.log(`ERROR ${filePath} ${message}`)
          if (message.includes('All Tinify API keys')) break
        }
      }

      if (!options.dryRun) {
        printCompressionCount(keyPool)
        console.log('Note: each file costs 2 compressions (shrink + resize).')
      }
    } else {
      for (const filePath of files) {
        try {
          await resizeFile(filePath, options, rootInputPath, stats)
        } catch (error) {
          stats.errors += 1
          const message = error instanceof Error ? error.message : String(error)
          console.log(`ERROR ${filePath} ${message}`)
        }
      }
    }

    console.log('---')
    console.log(`resized: ${stats.resized}`)
    console.log(`skipped: ${stats.skipped}`)
    console.log(`previewed: ${stats.previewed}`)
    console.log(`errors: ${stats.errors}`)

    if (stats.resized > 0 && (stats.sourceBytes > 0 || stats.outputBytes > 0)) {
      const delta = stats.outputBytes - stats.sourceBytes
      const sign = delta > 0 ? '+' : ''
      console.log(`source-bytes: ${stats.sourceBytes}`)
      console.log(`output-bytes: ${stats.outputBytes}`)
      console.log(`delta: ${sign}${delta}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    printUsage()
    process.exitCode = 1
  }
}

export function run(args) { main(args) }