#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { convertToWebp, TINIFY_SUPPORTED, resolveApiKeys, createKeyPool, isQuotaError, rotateKey, printCompressionCount } from './tinify/index.mjs'

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

function printUsage() {
  console.log(`Usage:
  image-cli webp <file-or-dir> [--api-key key1,key2,...] [--recursive] [--replace] [--output-dir <dir>] [--skip-larger] [--dry-run]
  image-cli webp <file-or-dir> --engine local [--recursive] [--replace] [--quality 100] [--jpg-mode preserve|skip] [--output-dir <dir>] [--skip-larger] [--dry-run]

Engines:
  tinify  (default) Cloud compression + WebP conversion via TinyPNG API.
          Free tier: 500 compressions/month per key. Each file = 2 compressions.
          Supports a key pool: --api-key key1,key2,key3
          Also reads TINIFY_API_KEYS or TINIFY_API_KEY env vars.
          Get a free API key at https://tinify.com/developers
  local   Local conversion via sharp. PNG->lossless WebP, JPG->high-quality WebP.`)
}

function parseArgs(argv) {
  const options = {
    inputPath: '',
    recursive: false,
    replace: false,
    quality: 100,
    jpgMode: 'preserve',
    outputDir: '',
    skipLarger: false,
    dryRun: false,
    engine: 'tinify',
    apiKeys: [],
  }

  const args = [...argv]
  options.inputPath = args.shift() ?? ''

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--recursive') { options.recursive = true; continue }
    if (arg === '--replace') { options.replace = true; continue }
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

    if (arg === '--quality') {
      const value = Number(args.shift())
      if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('--quality must be an integer between 1 and 100')
      options.quality = value
      continue
    }

    if (arg === '--jpg-mode') {
      const value = args.shift()
      if (value !== 'preserve' && value !== 'skip') throw new Error('--jpg-mode must be preserve or skip')
      options.jpgMode = value
      continue
    }

    if (arg === '--output-dir') {
      const value = args.shift()
      if (!value) throw new Error('--output-dir requires a directory path')
      options.outputDir = value
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!options.inputPath) throw new Error('Missing <file-or-dir>')

  if (options.engine === 'tinify') options.apiKeys = resolveApiKeys(options.apiKeys)

  return options
}

async function collectFiles(targetPath, recursive) {
  const stat = await fs.stat(targetPath)
  if (stat.isFile()) return [targetPath]
  if (!stat.isDirectory()) return []

  const results = []
  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name)
    if (entry.isFile()) { results.push(fullPath); continue }
    if (entry.isDirectory() && recursive) results.push(...await collectFiles(fullPath, true))
  }
  return results
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function getOutputPath(filePath, rootInputPath, outputDir) {
  const parsed = path.parse(filePath)
  const relativeDir = path.relative(rootInputPath, parsed.dir)
  const normalizedRelativeDir = relativeDir === '.' ? '' : relativeDir
  if (!outputDir) return path.join(parsed.dir, `${parsed.name}.webp`)
  return path.join(outputDir, normalizedRelativeDir, `${parsed.name}.webp`)
}

async function ensureDirectoryForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

// ── Tinify engine ─────────────────────────────────────────────────────────────

async function convertFileTinify(keyPool, filePath, options, rootInputPath, stats) {
  const ext = path.extname(filePath).toLowerCase()
  if (!TINIFY_SUPPORTED.has(ext)) {
    stats.skipped += 1
    console.log(`SKIPPED ${filePath} unsupported format for tinify engine`)
    return
  }

  const outputPath = getOutputPath(filePath, rootInputPath, options.outputDir)
  const sourceSize = (await fs.stat(filePath)).size

  if (options.dryRun) {
    stats.previewed += 1
    console.log(`DRY-RUN ${filePath} -> ${outputPath} (tinify engine, ~${formatBytes(sourceSize)})`)
    return
  }

  await ensureDirectoryForFile(outputPath)

  while (true) {
    try {
      await convertToWebp(keyPool.tinify, filePath, outputPath)

      const outputSize = (await fs.stat(outputPath)).size
      if (options.skipLarger && outputSize >= sourceSize) {
        await fs.unlink(outputPath)
        stats.skipped += 1
        console.log(`SKIPPED ${filePath} output larger (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)})`)
        return
      }

      if (options.replace && path.resolve(outputPath) !== path.resolve(filePath)) await fs.unlink(filePath)

      stats.created += 1
      stats.sourceBytes += sourceSize
      stats.outputBytes += outputSize
      const keyLabel = `key[${keyPool.index + 1}/${keyPool.keys.length}]`
      console.log(`CREATED ${filePath} -> ${outputPath} (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)}) [tinify ${keyLabel}, used: ${keyPool.tinify.compressionCount}]`)
      return
    } catch (err) {
          if (!isQuotaError(err)) throw err
          rotateKey(keyPool, err)
        }
  }
}

// ── Local (sharp) engine ──────────────────────────────────────────────────────

async function convertFile(filePath, options, rootInputPath, stats) {
  const ext = path.extname(filePath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    stats.skipped += 1
    console.log(`SKIPPED ${filePath} unsupported format`)
    return
  }
  if ((ext === '.jpg' || ext === '.jpeg') && options.jpgMode === 'skip') {
    stats.skipped += 1
    console.log(`SKIPPED ${filePath} jpg-mode=skip`)
    return
  }

  const outputPath = getOutputPath(filePath, rootInputPath, options.outputDir)
  const sourceBuffer = await fs.readFile(filePath)
  const sourceSize = sourceBuffer.byteLength

  let pipeline = sharp(sourceBuffer, { animated: true }).withMetadata()
  if (ext === '.png') {
    pipeline = pipeline.webp({ lossless: true, effort: 6 })
  } else {
    pipeline = pipeline.webp({ quality: options.quality, alphaQuality: 100, effort: 6, smartSubsample: true })
  }

  const outputBuffer = await pipeline.toBuffer()
  const outputSize = outputBuffer.byteLength

  if (options.skipLarger && outputSize >= sourceSize) {
    stats.skipped += 1
    console.log(`SKIPPED ${filePath} output larger (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)})`)
    return
  }

  if (options.dryRun) {
    stats.previewed += 1
    console.log(`DRY-RUN ${filePath} -> ${outputPath} (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)})`)
    return
  }

  await ensureDirectoryForFile(outputPath)
  await fs.writeFile(outputPath, outputBuffer)
  if (options.replace && path.resolve(outputPath) !== path.resolve(filePath)) await fs.unlink(filePath)

  stats.created += 1
  stats.sourceBytes += sourceSize
  stats.outputBytes += outputSize
  console.log(`CREATED ${filePath} -> ${outputPath} (${formatBytes(sourceSize)} -> ${formatBytes(outputSize)})`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(argv) {
  try {
    const options = parseArgs(argv)
    const absoluteInputPath = path.resolve(options.inputPath)
    const inputStat = await fs.stat(absoluteInputPath)
    const rootInputPath = inputStat.isDirectory() ? absoluteInputPath : path.dirname(absoluteInputPath)
    const files = await collectFiles(absoluteInputPath, options.recursive)

    const stats = { created: 0, skipped: 0, previewed: 0, errors: 0, sourceBytes: 0, outputBytes: 0 }

    if (options.engine === 'tinify') {
      const keyPool = await createKeyPool(options.apiKeys)

      for (const filePath of files) {
        try {
          await convertFileTinify(keyPool, filePath, options, rootInputPath, stats)
        } catch (error) {
          stats.errors += 1
          const message = error instanceof Error ? error.message : String(error)
          console.log(`ERROR ${filePath} ${message}`)
          if (message.includes('All Tinify API keys')) break
        }
      }

      if (!options.dryRun) {
        printCompressionCount(keyPool)
        console.log('Note: each file costs 2 compressions (shrink + convert).')
      }
    } else {
      for (const filePath of files) {
        try {
          await convertFile(filePath, options, rootInputPath, stats)
        } catch (error) {
          stats.errors += 1
          const message = error instanceof Error ? error.message : String(error)
          console.log(`ERROR ${filePath} ${message}`)
        }
      }
    }

    console.log('---')
    console.log(`created: ${stats.created}`)
    console.log(`skipped: ${stats.skipped}`)
    console.log(`previewed: ${stats.previewed}`)
    console.log(`errors: ${stats.errors}`)
    if (stats.created > 0) {
      const delta = stats.outputBytes - stats.sourceBytes
      console.log(`source-bytes: ${stats.sourceBytes}`)
      console.log(`output-bytes: ${stats.outputBytes}`)
      console.log(`delta: ${delta > 0 ? '+' : ''}${delta}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    printUsage()
    process.exitCode = 1
  }
}

export function run(args) { main(args) }
