import fs from 'node:fs/promises'
import path from 'node:path'

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function printUsage() {
  console.log(`Usage:
  image-cli rmbg <file-or-dir> [--recursive] [--replace] [--output-dir <dir>] [--dry-run]

Options:
  --recursive         Recursively process directories
  --replace           Delete original file after success (irreversible)
  --output-dir <dir>  Output directory (preserves relative structure)
  --dry-run           Print plan without writing files

Output: <name>_nobg.png alongside the source file (or in --output-dir)

Note: First run downloads the FeyNoBg model (~300MB) and caches it locally.
Requires Python with nobg and loadimg installed: pip install nobg loadimg`)
}

function parseArgs(argv) {
  const options = {
    inputPath: '',
    recursive: false,
    replace: false,
    outputDir: '',
    dryRun: false,
  }

  const args = [...argv]

  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    printUsage()
    process.exit(0)
  }

  options.inputPath = args.shift() ?? ''

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--recursive')  { options.recursive = true; continue }
    if (arg === '--replace')    { options.replace = true;   continue }
    if (arg === '--dry-run')    { options.dryRun = true;    continue }

    if (arg === '--output-dir') {
      const value = args.shift()
      if (!value) throw new Error('--output-dir requires a directory path')
      options.outputDir = value
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!options.inputPath) throw new Error('Missing <file-or-dir>')

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
    if (entry.isFile()) {
      results.push(fullPath)
    } else if (entry.isDirectory() && recursive) {
      results.push(...await collectFiles(fullPath, true))
    }
  }

  return results
}

function getOutputPath(filePath, rootInputPath, outputDir) {
  const parsed = path.parse(filePath)
  const stem = `${parsed.name}_nobg`

  if (!outputDir) {
    return path.join(parsed.dir, `${stem}.png`)
  }

  const relativeDir = path.relative(rootInputPath, parsed.dir)
  const normalizedDir = relativeDir === '.' ? '' : relativeDir
  return path.join(outputDir, normalizedDir, `${stem}.png`)
}

async function main(argv) {
  try {
    const options = parseArgs(argv)
    const absoluteInputPath = path.resolve(options.inputPath)
    const inputStat = await fs.stat(absoluteInputPath)
    const rootInputPath = inputStat.isDirectory() ? absoluteInputPath : path.dirname(absoluteInputPath)

    const allFiles = await collectFiles(absoluteInputPath, options.recursive)
    const files = allFiles.filter(f => SUPPORTED_EXTENSIONS.has(path.extname(f).toLowerCase()))

    if (files.length === 0) {
      console.log('No supported image files found.')
      return
    }

    const stats = { created: 0, skipped: 0, previewed: 0, errors: 0 }

    // Build input/output pairs
    const items = files.map(filePath => ({
      inputPath: filePath,
      outputPath: getOutputPath(filePath, rootInputPath, options.outputDir),
    }))

    if (options.dryRun) {
      for (const { inputPath, outputPath } of items) {
        console.log(`DRY-RUN  ${inputPath} -> ${outputPath}`)
        stats.previewed += 1
      }
    } else {
      // Single Python subprocess handles all files — model loads once
      const { removeBackgroundBatch } = await import('./feynobg.mjs')
      const results = await removeBackgroundBatch(items)

      for (const { inputPath, outputPath } of items) {
        if (results.err.has(inputPath)) {
          stats.errors += 1
          console.log(`ERROR    ${inputPath}  ${results.err.get(inputPath)}`)
        } else {
          if (options.replace && path.resolve(outputPath) !== path.resolve(inputPath)) {
            await fs.unlink(inputPath)
          }
          stats.created += 1
          console.log(`REMOVED  ${inputPath} -> ${outputPath}`)
        }
      }
    }

    console.log('---')
    console.log(`removed:   ${stats.created}`)
    console.log(`skipped:   ${stats.skipped}`)
    console.log(`previewed: ${stats.previewed}`)
    console.log(`errors:    ${stats.errors}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    printUsage()
    process.exitCode = 1
  }
}

export function run(args) { main(args) }
