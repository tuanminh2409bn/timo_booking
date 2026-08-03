export const DEFAULT_MONEY_CURRENCY = "EUR";
export const DEFAULT_MONEY_SCALE = 2;

const getMoneyMultiplier = (scale: number) => 10 ** scale;

const normalizeMoneyText = (value: string): string => value.trim().replace(/[^0-9.-]/g, "");

const hasValidMoneyTextScale = (value: string, scale: number): boolean => {
  if (value.length === 0 || value === "-" || value === "." || value === "-.") {
    return false;
  }

  if (!/^-?(?:\d+|\d*\.\d+)$/.test(value)) {
    return false;
  }

  const decimalPart = value.split(".")[1];
  if (decimalPart === undefined) {
    return true;
  }

  return decimalPart.replace(/0+$/, "").length <= scale;
};

const getMinorUnitFromMoneyText = (value: string, scale: number): number | undefined => {
  if (!hasValidMoneyTextScale(value, scale)) {
    return undefined;
  }

  const multiplier = getMoneyMultiplier(scale);
  const isNegative = value.startsWith("-");
  const unsignedText = isNegative ? value.slice(1) : value;
  const [wholePart = "0", decimalPart = ""] = unsignedText.split(".");
  const wholeMinor = BigInt(wholePart || "0") * BigInt(multiplier);
  const decimalMinor = BigInt(decimalPart.padEnd(scale, "0").slice(0, scale) || "0");
  const minorUnit = Number((isNegative ? -1n : 1n) * (wholeMinor + decimalMinor));

  return Number.isSafeInteger(minorUnit) ? minorUnit : undefined;
};

export const roundMoney = (value: number, scale = DEFAULT_MONEY_SCALE): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const multiplier = getMoneyMultiplier(scale);
  return Math.round((value + Math.sign(value) * Number.EPSILON) * multiplier) / multiplier;
};

export const toMoneyMinorUnit = (value: number, scale = DEFAULT_MONEY_SCALE): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const exactMinorUnit = getMinorUnitFromMoneyText(value.toString(), scale);
  if (exactMinorUnit !== undefined) {
    return exactMinorUnit;
  }

  const multiplier = getMoneyMultiplier(scale);
  return Math.round((value + Math.sign(value) * Number.EPSILON) * multiplier);
};

export const fromMoneyMinorUnit = (minorUnit: number, scale = DEFAULT_MONEY_SCALE): number =>
  roundMoney(minorUnit / getMoneyMultiplier(scale), scale);

export const parseMoneyMinorUnitInput = (
  value: string | number | undefined,
  options: {
    allowZero?: boolean;
    scale?: number;
  } = {},
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const scale = options.scale ?? DEFAULT_MONEY_SCALE;
  const normalizedText = typeof value === "number" ? value.toString() : normalizeMoneyText(value);
  const minorUnit = getMinorUnitFromMoneyText(normalizedText, scale);

  if (minorUnit === undefined) {
    return undefined;
  }

  const isInAllowedRange = options.allowZero === true ? minorUnit >= 0 : minorUnit > 0;

  if (!isInAllowedRange) {
    return undefined;
  }

  return minorUnit;
};

export const hasValidMoneyScale = (value: number, scale = DEFAULT_MONEY_SCALE): boolean => {
  if (!Number.isFinite(value)) {
    return false;
  }

  return hasValidMoneyTextScale(value.toString(), scale);
};

export const parseMoneyInput = (
  value: string | number | undefined,
  options: {
    allowZero?: boolean;
    scale?: number;
  } = {},
): number | undefined => {
  const scale = options.scale ?? DEFAULT_MONEY_SCALE;
  const minorUnit = parseMoneyMinorUnitInput(value, options);

  if (minorUnit === undefined) {
    return undefined;
  }

  return fromMoneyMinorUnit(minorUnit, scale);
};

export const addMoney = (left: number, right: number, scale = DEFAULT_MONEY_SCALE): number =>
  fromMoneyMinorUnit(toMoneyMinorUnit(left, scale) + toMoneyMinorUnit(right, scale), scale);

export const subtractMoney = (left: number, right: number, scale = DEFAULT_MONEY_SCALE): number =>
  fromMoneyMinorUnit(toMoneyMinorUnit(left, scale) - toMoneyMinorUnit(right, scale), scale);

export const sumMoney = (values: number[], scale = DEFAULT_MONEY_SCALE): number =>
  fromMoneyMinorUnit(
    values.reduce((sum, value) => sum + toMoneyMinorUnit(value, scale), 0),
    scale,
  );

export const divideMoney = (
  value: number,
  divisor: number,
  scale = DEFAULT_MONEY_SCALE,
): number => {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    return 0;
  }

  return fromMoneyMinorUnit(Math.round(toMoneyMinorUnit(value, scale) / divisor), scale);
};

export const allocateMoneyMinorUnits = (totalMinorUnit: number, weights: number[]): number[] => {
  if (weights.length === 0) {
    return [];
  }

  const total = BigInt(Math.max(0, Math.trunc(totalMinorUnit)));
  if (total === 0n) {
    return weights.map(() => 0);
  }

  const normalizedWeights = weights.map((weight) => Math.max(0, Math.trunc(weight)));
  const totalWeightNumber = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = totalWeightNumber > 0 ? normalizedWeights : weights.map(() => 1);
  const totalWeight = BigInt(effectiveWeights.reduce((sum, weight) => sum + weight, 0));

  const allocations = effectiveWeights.map((weight, index) => {
    const weightedTotal = total * BigInt(weight);
    return {
      index,
      minorUnit: Number(weightedTotal / totalWeight),
      remainder: weightedTotal % totalWeight,
    };
  });
  let remainder = Number(
    total - BigInt(allocations.reduce((sum, item) => sum + item.minorUnit, 0)),
  );
  const byRemainder = [...allocations].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.index - right.index;
    }

    return left.remainder > right.remainder ? -1 : 1;
  });

  for (let index = 0; remainder > 0; index += 1) {
    const target = byRemainder[index % byRemainder.length];
    if (!target) {
      break;
    }

    target.minorUnit += 1;
    remainder -= 1;
  }

  return allocations
    .sort((left, right) => left.index - right.index)
    .map((allocation) => allocation.minorUnit);
};

export const resolveMoneyAmount = (
  fallbackAmount: number | undefined,
  minorUnit: number | undefined,
  scale = DEFAULT_MONEY_SCALE,
): number => {
  if (typeof minorUnit === "number" && Number.isSafeInteger(minorUnit)) {
    return fromMoneyMinorUnit(minorUnit, scale);
  }

  return roundMoney(fallbackAmount ?? 0, scale);
};
