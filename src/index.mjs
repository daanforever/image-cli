#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import updateNotifier from 'update-notifier'
import packageJson from '../package.json' with { type: 'json' }

// Load .env from current working directory if present
for (const envFile of [path.join(process.cwd(), '.env')]) {
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([^#][^=]*?)\s*=\s*(.*?)\s*$/)
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  }
}

// Check for updates in background (cached 24h, opt-out via NO_UPDATE_NOTIFIER=1)
updateNotifier({ pkg: packageJson }).notify()

import { run as runConvert } from './convert.mjs'
import { run as runWebp } from './webp.mjs'
import { run as runResize } from './resize.mjs'
import { run as runCrop } from './crop.mjs'
import { run as runOptimize } from './optimize.mjs'
import { run as runInspect } from './inspect.mjs'
import { run as runSlice } from './slice.mjs'
import { run as runRmbg } from './rmbg.mjs'
import { run as runInstall } from './install.mjs'
import { run as runUpdate } from './update.mjs'

const COMMANDS = {
  convert: runConvert,
  webp: runWebp,
  resize: runResize,
  crop: runCrop,
  optimize: runOptimize,
  inspect: runInspect,
  slice: runSlice,
  rmbg: runRmbg,
  install: runInstall,
  update: runUpdate,
}

const [, , cmd, ...args] = process.argv

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`Usage: image-cli <command> [options]

Commands:
  convert   Convert between PNG/JPEG/WebP/AVIF/BMP/TIFF formats
  webp      Convert PNG/JPG/JPEG to WebP (fidelity-first)
  resize    Resize images by width, height, or max-side
  crop      Crop images by size or region
  optimize  Lossless optimize PNG/WebP (and optionally JPEG)
  inspect   Inspect image metadata
  slice     Slice sprite sheets into tiles
  rmbg      Remove image background using AI (BiRefNet)
  install   Install AI agent skills to ~/.claude/skills
  update    Update image-cli to the latest version

Run \`image-cli <command> --help\` for command-specific options.`)
  process.exit(0)
}

const handler = COMMANDS[cmd]
if (!handler) {
  console.error(`Unknown command: ${cmd}`)
  console.error(`Run \`image-cli --help\` for available commands.`)
  process.exit(1)
}

handler(args)
