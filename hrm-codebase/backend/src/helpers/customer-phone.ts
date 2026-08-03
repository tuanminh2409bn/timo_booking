import { createHash } from "node:crypto";

const ALLOWED_PHONE_FORMAT_CHARACTERS = /^[0-9+()\s.-]+$/;

export const normalizeCustomerPhone = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return undefined;
  }

  if (!ALLOWED_PHONE_FORMAT_CHARACTERS.test(trimmedValue)) {
    return undefined;
  }

  const digits = trimmedValue.replace(/\D/g, "");

  return digits ? `+${digits}` : undefined;
};

export const getCustomerDocumentId = (phone: string): string =>
  createHash("sha256").update(phone).digest("hex");

export const normalizeCustomerName = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

  if (!normalized || normalized === "khách lẻ" || normalized === "khach le") {
    return undefined;
  }

  return normalized;
};

export const isAnonymousCustomerName = (value: string | undefined): boolean =>
  value !== undefined && normalizeCustomerName(value) === undefined;

export const getCustomerNameDocumentId = (normalizedName: string): string =>
  createHash("sha256").update(`name:${normalizedName}`).digest("hex");

export const canMergeCustomerByName = (
  existingPhone: string | undefined,
  incomingPhone: string | undefined,
): boolean => {
  const normalizedIncomingPhone = normalizeCustomerPhone(incomingPhone);

  if (normalizedIncomingPhone === undefined) {
    return true;
  }

  const normalizedExistingPhone = normalizeCustomerPhone(existingPhone);
  return (
    normalizedExistingPhone === undefined || normalizedExistingPhone === normalizedIncomingPhone
  );
};
