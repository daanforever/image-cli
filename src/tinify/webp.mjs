/**
 * tinify/webp.mjs
 *
 * Convert images to WebP using the Tinify API.
 * Each call costs 2 compressions: 1 shrink + 1 convert.
 *
 * Supported input: PNG, JPG/JPEG, WebP, AVIF
 *
 * Docs: https://tinify.com/developers/reference/nodejs#converting-images
 */

/**
 * Convert a single image to WebP via Tinify.
 *
 * @param {object} tinify - Tinify instance (already has .key set)
 * @param {string} inputPath - absolute path to source image
 * @param {string} outputPath - absolute path to output .webp file
 */
export async function convertToWebp(tinify, inputPath, outputPath) {
  const source = tinify.fromFile(inputPath)
  const converted = source.convert({ type: 'image/webp' })
  await converted.toFile(outputPath)
}
