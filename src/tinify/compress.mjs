/**
 * tinify/compress.mjs
 *
 * Compress images using the Tinify API (shrink only, no format change).
 * Supports uploading from local file, buffer, or URL.
 * Each call costs 1 compression.
 *
 * Supported input: PNG, JPG/JPEG, WebP, AVIF
 *
 * Docs: https://tinify.com/developers/reference/nodejs#compressing-images
 */

/**
 * Compress a local image file in-place (same format, smaller size).
 *
 * @param {object} tinify - Tinify instance (already has .key set)
 * @param {string} inputPath - absolute path to source image
 * @param {string} outputPath - absolute path to output file
 */
export async function compressFile(tinify, inputPath, outputPath) {
  const source = tinify.fromFile(inputPath)
  await source.toFile(outputPath)
}

/**
 * Compress an image from a Buffer.
 *
 * @param {object} tinify - Tinify instance (already has .key set)
 * @param {Buffer} inputBuffer - raw image data
 * @returns {Promise<Buffer>} compressed image data
 */
export async function compressBuffer(tinify, inputBuffer) {
  return new Promise((resolve, reject) => {
    tinify.fromBuffer(inputBuffer).toBuffer((err, resultData) => {
      if (err) reject(err)
      else resolve(resultData)
    })
  })
}

/**
 * Compress an image from a remote URL and save to file.
 *
 * @param {object} tinify - Tinify instance (already has .key set)
 * @param {string} url - public URL of the source image
 * @param {string} outputPath - absolute path to output file
 */
export async function compressFromUrl(tinify, url, outputPath) {
  const source = tinify.fromUrl(url)
  await source.toFile(outputPath)
}
