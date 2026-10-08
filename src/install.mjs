import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Skills bundled with this package
const BUNDLED_SKILLS_DIR = path.join(__dirname, '..', 'skills')

function printUsage() {
  console.log(`Usage:
  image-cli install [--dir <path>] [--dry-run] [--force]

Options:
  --dir <path>  Target directory to install skills into (default: ~/.claude/skills)
  --dry-run     Show what would be installed without writing files
  --force       Overwrite existing skill files

Installs all image-* skills and image-shared into the target directory.`)
}

function parseArgs(argv) {
  const options = {
    dir: path.join(os.homedir(), '.claude', 'skills'),
    dryRun: false,
    force: false,
  }

  const args = [...argv]

  if (args[0] === '--help' || args[0] === '-h') {
    printUsage()
    process.exit(0)
  }

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--force') { options.force = true; continue }

    if (arg === '--dir') {
      const value = args.shift()
      if (!value) throw new Error('--dir requires a path')
      options.dir = value
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

async function getSkillDirs() {
  const entries = await fs.readdir(BUNDLED_SKILLS_DIR, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
}

async function installSkill(skillName, targetDir, options) {
  const srcSkillDir = path.join(BUNDLED_SKILLS_DIR, skillName)
  const dstSkillDir = path.join(targetDir, skillName)
  const srcFile = path.join(srcSkillDir, 'SKILL.md')
  const dstFile = path.join(dstSkillDir, 'SKILL.md')

  // Check if destination already exists
  let exists = false
  try {
    await fs.access(dstFile)
    exists = true
  } catch {}

  if (exists && !options.force) {
    console.log(`SKIPPED  ${skillName}  (already exists, use --force to overwrite)`)
    return 'skipped'
  }

  if (options.dryRun) {
    console.log(`DRY-RUN  ${skillName} -> ${dstFile}`)
    return 'dry-run'
  }

  await fs.mkdir(dstSkillDir, { recursive: true })
  await fs.copyFile(srcFile, dstFile)
  console.log(`INSTALLED  ${skillName} -> ${dstFile}`)
  return 'installed'
}

async function main(argv) {
  try {
    const options = parseArgs(argv)

    let skillDirs
    try {
      skillDirs = await getSkillDirs()
    } catch {
      console.error('Error: bundled skills directory not found. Package may be corrupted.')
      process.exitCode = 1
      return
    }

    if (skillDirs.length === 0) {
      console.error('Error: no skills found in package.')
      process.exitCode = 1
      return
    }

    console.log(`Installing ${skillDirs.length} skill(s) to: ${options.dir}`)
    console.log()

    const counts = { installed: 0, skipped: 0, 'dry-run': 0, error: 0 }

    for (const skillName of skillDirs) {
      try {
        const result = await installSkill(skillName, options.dir, options)
        counts[result] = (counts[result] ?? 0) + 1
      } catch (err) {
        console.log(`ERROR    ${skillName}  ${err instanceof Error ? err.message : String(err)}`)
        counts.error += 1
      }
    }

    console.log()
    console.log('---')
    if (options.dryRun) {
      console.log(`Would install: ${counts['dry-run']}  skipped: ${counts.skipped}`)
    } else {
      console.log(`installed: ${counts.installed}  skipped: ${counts.skipped}  errors: ${counts.error}`)
      if (counts.installed > 0) {
        console.log()
        console.log('Skills are ready. AI agents will pick them up on next invocation.')
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    printUsage()
    process.exitCode = 1
  }
}

export function run(args) { main(args) }
