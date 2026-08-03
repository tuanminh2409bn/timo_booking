import { Buffer } from "node:buffer";

const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type ImageUploadValidationResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: "fileTooLarge" | "invalidImage" };

const hasBytes = (buffer: Buffer, bytes: number[], offset = 0) =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

const isGif = (buffer: Buffer) =>
  buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
  buffer.subarray(0, 6).toString("ascii") === "GIF89a";

const isImageContentMatch = (contentType: string, buffer: Buffer) => {
  if (contentType === "image/png") {
    return hasBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }

  if (contentType === "image/jpeg") {
    return hasBytes(buffer, [0xff, 0xd8, 0xff]);
  }

  if (contentType === "image/gif") {
    return isGif(buffer);
  }

  if (contentType === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }

  return false;
};

export const decodeImageUpload = ({
  base64,
  contentType,
  maxBytes,
}: {
  base64: string;
  contentType: string;
  maxBytes: number;
}): ImageUploadValidationResult => {
  const normalizedContentType = contentType.trim().toLowerCase();
  const normalizedBase64 = base64.trim();
  let paddingBytes = 0;

  if (normalizedBase64.endsWith("==")) {
    paddingBytes = 2;
  } else if (normalizedBase64.endsWith("=")) {
    paddingBytes = 1;
  }
  const estimatedDecodedBytes = Math.floor(normalizedBase64.length / 4) * 3 - paddingBytes;

  if (estimatedDecodedBytes > maxBytes) {
    return { ok: false, reason: "fileTooLarge" };
  }

  if (
    !ALLOWED_IMAGE_CONTENT_TYPES.has(normalizedContentType) ||
    normalizedBase64.length === 0 ||
    normalizedBase64.length % 4 !== 0 ||
    !BASE64_PATTERN.test(normalizedBase64)
  ) {
    return { ok: false, reason: "invalidImage" };
  }

  const buffer = Buffer.from(normalizedBase64, "base64");

  if (buffer.length > maxBytes) {
    return { ok: false, reason: "fileTooLarge" };
  }

  if (!isImageContentMatch(normalizedContentType, buffer)) {
    return { ok: false, reason: "invalidImage" };
  }

  return { ok: true, buffer };
};
