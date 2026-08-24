/**
 * uploadCompressedImage.js
 *
 * Reusable utility for compressing an image to ≤ 10 KB (WebP) and uploading
 * it to Firebase Storage. Returns the secure download URL.
 *
 * Strategy:
 *   1. Draw the source image onto a canvas at its native resolution.
 *   2. Iteratively reduce quality (0.8 → 0.1 in steps of 0.1) and scale
 *      (100% → 50% → 25% …) until the WebP blob is ≤ MAX_SIZE_BYTES.
 *   3. If we cannot reach the target after MAX_ITERATIONS, throw a
 *      descriptive error prompting the teacher to use a simpler image.
 *   4. Upload the compressed blob to Firebase Storage and return the URL.
 *
 * Usage:
 *   import { uploadCompressedImage } from '../utils/uploadCompressedImage';
 *   const { url, sizeKb } = await uploadCompressedImage(file, 'mcq_images/SESSION/q1_A.webp', storage);
 */

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 10 * 1024; // 10 KB strict limit
const MAX_ITERATIONS = 20;         // maximum compression attempts

// ─── Core Compression ────────────────────────────────────────────────────────

/**
 * Compresses a File or Blob to ≤ MAX_SIZE_BYTES using Canvas + WebP.
 *
 * @param {File|Blob} fileOrBlob
 * @returns {Promise<Blob>} compressed WebP blob
 * @throws {Error} if image cannot be compressed to the target size
 */
export const compressImageToWebP = (fileOrBlob) => {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(fileOrBlob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let scaleFactor = 1.0;
      let quality = 0.8;
      let iterations = 0;

      // Inner recursive attempt function
      const attempt = () => {
        iterations++;

        canvas.width  = Math.max(1, Math.round(img.naturalWidth  * scaleFactor));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scaleFactor));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Canvas toBlob returned null. The image format may be unsupported.'));
              return;
            }

            if (blob.size <= MAX_SIZE_BYTES) {
              // ✅ Target reached
              resolve(blob);
              return;
            }

            if (iterations >= MAX_ITERATIONS) {
              reject(
                new Error(
                  `Image compression failed after ${MAX_ITERATIONS} attempts.\n` +
                  `Final size: ${(blob.size / 1024).toFixed(1)} KB (limit: ${MAX_SIZE_BYTES / 1024} KB).\n\n` +
                  `Please use a simpler or smaller source image (e.g., a diagram with few colors, or a screenshot at low resolution).`
                )
              );
              return;
            }

            // Reduce quality first (to minimum 0.1), then start scaling down
            if (quality > 0.1) {
              quality = Math.max(0.1, quality - 0.1);
            } else {
              // Quality already at minimum — reduce scale by 50%
              scaleFactor *= 0.5;
            }

            attempt();
          },
          'image/webp',
          quality
        );
      };

      attempt();
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image. Ensure the file is a valid image (PNG, JPG, GIF, WebP, BMP).'));
    };

    img.src = objectUrl;
  });
};

// ─── Upload Pipeline ─────────────────────────────────────────────────────────

/**
 * Compress an image file to ≤ 10 KB and upload it to Firebase Storage.
 *
 * @param {File|Blob} file          — source image file (any format)
 * @param {string}    storagePath   — destination path in Firebase Storage
 * @param {object}    storageInstance — Firebase Storage instance (from getStorage)
 * @returns {Promise<{ url: string, sizeKb: number }>}
 * @throws {Error} on compression failure or upload failure
 */
export const uploadCompressedImage = async (file, storagePath, storageInstance) => {
  // Step 1: Compress
  let compressedBlob;
  try {
    compressedBlob = await compressImageToWebP(file);
  } catch (compressionError) {
    throw new Error(`Compression Error: ${compressionError.message}`);
  }

  const sizeKb = compressedBlob.size / 1024;

  // Step 2: Upload to Firebase Storage
  try {
    const storageRef = ref(storageInstance, storagePath);
    await uploadBytes(storageRef, compressedBlob, { contentType: 'image/webp' });
    const url = await getDownloadURL(storageRef);
    return { url, sizeKb };
  } catch (uploadError) {
    throw new Error(`Firebase Upload Error: ${uploadError.message}`);
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determines if a stored MCQ field value is an image object.
 * Works for both new image-mode ({ type: 'image', value: 'https://...' })
 * and old text-mode (plain string) payloads.
 *
 * @param {string|{type: string, value: string}} field
 * @returns {boolean}
 */
export const isImageField = (field) =>
  field !== null &&
  typeof field === 'object' &&
  field.type === 'image' &&
  typeof field.value === 'string' &&
  field.value.startsWith('http');

/**
 * Extracts the comparable value from an MCQ field for equality checks.
 * Used in auto-grading to compare selected_option with correctOptionText.
 *
 * @param {string|{type: string, value: string}} field
 * @returns {string}
 */
export const getFieldComparableValue = (field) => {
  if (isImageField(field)) return field.value;
  return typeof field === 'string' ? field : '';
};
