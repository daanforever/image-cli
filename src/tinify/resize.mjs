/**
 * tinify/resize.mjs
 *
 * Resize images using the Tinify API.
 * Each call costs 2 compressions: 1 shrink + 1 resize.
 *
 * Supported input: PNG, JPG/JPEG, WebP, AVIF
 *
 * Docs: https://tinify.com/developers/reference/nodejs#resizing-images
 *
 * Methods:
 *   scale  - Proportional scale. Provide width OR height (not both).
 *            Result has exactly the provided dimension.
 *   fit    - Proportional scale to fit within width × height.
 *            Provide both. Result will not exceed either dimension.
 *   cover  - Proportional scale + smart crop to exactly width × height.
 *            Provide both. Cropped area chosen by intelligent algorithm.
 *   thumb  - Advanced cover that also detects cut-out images with plain
 *            backgrounds. Adds background space or crops unimportant parts.
 *
 * Note: Tinify never scales up. If target > original, original size is kept.
 */

/**
 * Resize a single image via Tinify.
 *
 * @param {object} tinify - Tinify instance (already has .key set)
 * @param {string} inputPath - absolute path to source image
 * @param {string} outputPath - absolute path to output file (keeps original format)
 * @param {{ method: 'scale'|'fit'|'cover'|'thumb', width?: number, height?: number }} resizeOptions
 */
export async function resizeImage(tinify, inputPath, outputPath, resizeOptions) {
  const params = { method: resizeOptions.method }
  if (resizeOptions.width != null)  params.width  = resizeOptions.width
  if (resizeOptions.height != null) params.height = resizeOptions.height

  const source = tinify.fromFile(inputPath)
  const resized = source.resize(params)
  await resized.toFile(outputPath)
}
