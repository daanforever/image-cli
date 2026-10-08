import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

function printUsage() {
  console.log(`Usage:
  image-cli update

Updates @jany555/image-cli to the latest version via npm/npx cache refresh.`)
}

async function main(argv) {
  if (argv[0] === '--help' || argv[0] === '-h') {
    printUsage()
    process.exit(0)
  }

  // Check latest version first
  let latestVersion
  try {
    const res = spawnSync('npm', ['view', '@jany555/image-cli', 'version'], {
      encoding: 'utf8',
      shell: true,
    })
    latestVersion = res.stdout.trim()
  } catch {
    latestVersion = null
  }

  const currentVersion = pkg.version

  if (latestVersion && latestVersion === currentVersion) {
    console.log(`Already up to date. (@jany555/image-cli@${currentVersion})`)
    return
  }

  if (latestVersion) {
    console.log(`Updating @jany555/image-cli: ${currentVersion} → ${latestVersion}`)
  } else {
    console.log(`Updating @jany555/image-cli to latest...`)
  }

  // Re-install globally if installed globally, otherwise clear npx cache
  const isGlobal = isGlobalInstall()

  if (isGlobal) {
    console.log('Running: npm install -g @jany555/image-cli@latest')
    const result = spawnSync('npm', ['install', '-g', '@jany555/image-cli@latest'], {
      stdio: 'inherit',
      shell: true,
    })
    if (result.status !== 0) {
      console.error('Update failed. Try running manually:')
      console.error('  npm install -g @jany555/image-cli@latest')
      process.exitCode = 1
    } else {
      console.log('Update complete.')
    }
  } else {
    // npx usage: clear npx cache so next run fetches latest
    console.log('Clearing npx cache for @jany555/image-cli...')
    const result = spawnSync('npm', ['cache', 'clean', '--force'], {
      stdio: 'inherit',
      shell: true,
    })
    if (result.status !== 0) {
      console.error('Cache clear failed.')
      process.exitCode = 1
    } else {
      console.log('Cache cleared. Next time you run `npx @jany555/image-cli`, it will fetch the latest version.')
    }
  }
}

function isGlobalInstall() {
  try {
    const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true })
    const globalRoot = result.stdout.trim()
    // Check if our package is under the global node_modules
    return import.meta.url.includes(globalRoot.replace(/\\/g, '/'))
  } catch {
    return false
  }
}

export function run(args) { main(args) }
