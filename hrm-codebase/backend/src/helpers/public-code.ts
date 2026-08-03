export const PUBLIC_CODE_SEQUENCE_PAD = 1;

/**
 * Public codes are human-facing references stored separately from opaque
 * document IDs. Store IDs remain public codes; operational entity IDs do not.
 */
export const PUBLIC_CODE_CONFIG = {
  shop: { prefix: "S", fieldName: "code" },
  service: { prefix: "DV", fieldName: "serviceCode" },
  attendance: { prefix: "CC", fieldName: "attendanceCode" },
  customer: { prefix: "KH", fieldName: "customerCode" },
} as const;

export type PublicCodeType = keyof typeof PUBLIC_CODE_CONFIG;

export const formatPublicCode = (type: PublicCodeType, sequence: number): string => {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error("Public code sequence must be a positive integer");
  }

  const { prefix } = PUBLIC_CODE_CONFIG[type];
  return `${prefix}-${sequence.toString().padStart(PUBLIC_CODE_SEQUENCE_PAD, "0")}`;
};

export const normalizePublicCode = (value: string): string => value.trim().toUpperCase();

export const getPublicCodePattern = (type: PublicCodeType): RegExp =>
  new RegExp(`^${PUBLIC_CODE_CONFIG[type].prefix}-\\d+$`, "i");

export const isPublicCodeForType = (value: string, type: PublicCodeType): boolean =>
  getPublicCodePattern(type).test(value.trim());

export const parsePublicCodeSequence = (
  value: string,
  type: PublicCodeType,
): number | undefined => {
  const normalizedValue = normalizePublicCode(value);

  if (!isPublicCodeForType(normalizedValue, type)) {
    return undefined;
  }

  const sequence = Number(normalizedValue.split("-")[1]);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : undefined;
};
