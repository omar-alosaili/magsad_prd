// Re-encode user-supplied images before they leave the device.
//
// Phone photos carry an EXIF block: GPS coordinates of where the shot was
// taken, the timestamp, and the camera/phone identifiers. Our buckets are
// public, so uploading the original file published all of that alongside the
// picture. A canvas only ever holds decoded pixels, so drawing the image and
// re-encoding drops every metadata block — there is nothing left to strip.
//
// Downscaling rides along for free and is a real win on mobile data: a modern
// phone photo is 3-8 MB at 4000px, and nothing in this app renders one wider
// than ~860 CSS px.

export const MAX_UPLOAD_EDGE_PX = 1600;
export const UPLOAD_JPEG_QUALITY = 0.85;
// Generous ceiling on the ORIGINAL file, purely to avoid decoding something
// enormous into memory. The re-encoded result is what actually gets uploaded
// and is comfortably under the bucket's 5 MB limit.
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decodeImage(file: File): Promise<Decoded> {
  // createImageBitmap applies the EXIF orientation tag for us, so a portrait
  // photo doesn't come out sideways once the tag is gone.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall through to the <img> path (older Safari, odd codecs) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    // Browsers honour EXIF orientation on <img> by default (image-orientation:
    // from-image), so this path stays upright too.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image_decode_failed"));
      img.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

// Returns a metadata-free JPEG. Throws rather than silently falling back to
// the original: a quiet fallback would publish the GPS data the caller
// believes was removed.
export async function stripImageMetadata(file: File): Promise<File> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error("photo_too_large");

  const decoded = await decodeImage(file);
  try {
    const { width: w0, height: h0 } = decoded;
    if (!w0 || !h0) throw new Error("image_decode_failed");

    const scale = Math.min(1, MAX_UPLOAD_EDGE_PX / Math.max(w0, h0));
    const width = Math.max(1, Math.round(w0 * scale));
    const height = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    // Flatten onto white: JPEG has no alpha channel, and without this a
    // transparent PNG re-encodes with a black background.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, "image/jpeg", UPLOAD_JPEG_QUALITY),
    );
    if (!blob) throw new Error("image_encode_failed");

    const base = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    decoded.release();
  }
}
