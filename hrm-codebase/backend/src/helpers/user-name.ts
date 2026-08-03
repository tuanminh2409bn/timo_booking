import type { UserType } from "../repository/firestore/user/user.types.js";

// Nhãn hiển thị của user, luôn có giá trị: ưu tiên name → displayName → phần trước @ của email → uid.
export const getUserDisplayName = (
  user: Pick<UserType, "name" | "displayName" | "email" | "uid">,
) => user.name?.trim() || user.displayName?.trim() || user.email.split("@")[0] || user.uid;
