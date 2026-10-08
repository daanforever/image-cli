import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import os from 'node:os'
import fsSync from 'node:fs'

function getPythonPath() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python314', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'python.exe'),
  ]
  for (const p of candidates) {
    if (fsSync.existsSync(p)) return p
  }
  return 'python'
}

/**
 * Remove backgrounds for a batch of images in a single Python subprocess.
 * @param {Array<{inputPath: string, outputPath: string}>} items
 */
export async function removeBackgroundBatch(items) {
  if (items.length === 0) return []

  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                   process.env.HTTP_PROXY  || process.env.http_proxy  || null
  const mirror = process.env.HF_ENDPOINT ?? 'https://hf-mirror.com'

  // Ensure all output dirs exist before launching Python
  await Promise.all(items.map(({ outputPath }) =>
    fs.mkdir(path.dirname(outputPath), { recursive: true })
  ))

  const pythonPath = getPythonPath()

  // Pass items as a JSON literal embedded in the script — paths are JSON-safe
  const itemsJson = JSON.stringify(items.map(({ inputPath, outputPath }) => [inputPath, outputPath]))

  const script = `
import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
os.environ.setdefault('HF_ENDPOINT', ${JSON.stringify(mirror)})
import json
import torch
from loadimg import load_img
from nobg import AutoModel, AutoProcessor

# Auto-select device: CUDA > MPS > CPU
if torch.cuda.is_available():
    device = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device = "mps"
else:
    device = "cpu"

print(f"Device: {device}", flush=True)

use_amp = device == "cuda"

model = AutoModel.from_pretrained("feyninc/FeyNobg").eval().to(device)
processor = AutoProcessor.from_pretrained("feyninc/FeyNobg")

items = json.loads(${JSON.stringify(itemsJson)})

for input_path, output_path in items:
    try:
        image = load_img(input_path).convert("RGB")
        inputs = processor(image, return_tensors="pt").to(device)

        with torch.inference_mode():
            if use_amp:
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    outputs = model(pixel_values=inputs["pixel_values"])
            else:
                outputs = model(pixel_values=inputs["pixel_values"])

        alpha = processor.post_process_alpha_matting(
            outputs,
            target_sizes=[(image.height, image.width)],
        )[0]
        processor.cutout(image, alpha).save(output_path)
        print(f"OK\\t{output_path}", flush=True)
    except Exception as e:
        print(f"ERR\\t{input_path}\\t{e}", flush=True)

print("DONE", flush=True)
`

  console.log(`Loading FeyNoBg model (first run downloads ~300MB)...`)

  return new Promise((resolve, reject) => {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' }
    if (proxyUrl) {
      env.HTTPS_PROXY = proxyUrl
      env.HTTP_PROXY  = proxyUrl
    }

    const results = { ok: new Set(), err: new Map() }

    execFile(pythonPath, ['-c', script], { env, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout.includes('DONE')) {
        console.error('Python error:', stderr || error.message)
        return reject(new Error(stderr || error.message))
      }

      for (const line of stdout.split('\n')) {
        if (line.startsWith('OK\t')) {
          results.ok.add(line.slice(3).trim())
        } else if (line.startsWith('ERR\t')) {
          const parts = line.slice(4).split('\t')
          results.err.set(parts[0]?.trim(), parts[1]?.trim() ?? 'unknown error')
        } else if (line.startsWith('Device:')) {
          console.log(line.trim())
        }
      }

      resolve(results)
    })
  })
}

/**
 * Convenience wrapper for a single file (kept for compatibility).
 */
export async function removeBackground(imagePath, outputPath) {
  const results = await removeBackgroundBatch([{ inputPath: imagePath, outputPath }])
  if (results.err.has(imagePath)) {
    throw new Error(results.err.get(imagePath))
  }
}
