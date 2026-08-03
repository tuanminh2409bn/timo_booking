import type {
  ShopAttendanceDiscountType,
  ShopAttendanceDiscountTypeValue,
} from "../repository/firestore/shop/shop.types.js";
import { fromMoneyMinorUnit, toMoneyMinorUnit } from "./money.js";

// Giảm giá ở dạng FE gửi lên: `type` là cách nhập (số tiền hay phần trăm), `value` là con số FE gõ.
// Chưa phải số tiền giảm thực tế — số đó là `amount` trong `ShopAttendanceDiscountType`.
export type AttendanceDiscountInput = {
  type: ShopAttendanceDiscountTypeValue;
  value: number;
};

export type AttendanceDiscountValidationReason =
  | "discount_percentage_exceeds_100"
  | "discount_amount_exceeds_subtotal";

const getDiscountAmountCents = (subtotalAmountCents: number, discount: AttendanceDiscountInput) =>
  discount.type === "percentage"
    ? Math.round((subtotalAmountCents * discount.value) / 100)
    : toMoneyMinorUnit(discount.value);

export const getAttendanceDiscountValidationReason = (
  subtotalAmount: number,
  discount: Pick<AttendanceDiscountInput, "type" | "value"> | undefined,
): AttendanceDiscountValidationReason | undefined => {
  if (!discount || discount.value <= 0) {
    return undefined;
  }

  if (discount.type === "percentage" && discount.value > 100) {
    return "discount_percentage_exceeds_100";
  }

  const subtotalAmountCents = toMoneyMinorUnit(subtotalAmount);

  if (getDiscountAmountCents(subtotalAmountCents, discount) > subtotalAmountCents) {
    return "discount_amount_exceeds_subtotal";
  }

  return undefined;
};

export const buildAttendanceDiscount = (
  subtotalAmount: number,
  discount: AttendanceDiscountInput | undefined,
): ShopAttendanceDiscountType | undefined => {
  if (!discount) {
    return undefined;
  }

  const subtotalAmountCents = toMoneyMinorUnit(subtotalAmount);
  const discountAmountCents = Math.max(
    0,
    Math.min(subtotalAmountCents, getDiscountAmountCents(subtotalAmountCents, discount)),
  );

  return {
    type: discount.type,
    value: discount.value,
    amount: fromMoneyMinorUnit(discountAmountCents),
  };
};
