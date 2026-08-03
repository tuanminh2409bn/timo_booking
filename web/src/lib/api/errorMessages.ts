const DEFAULT_ERROR_MESSAGE = "Đã có lỗi xảy ra. Vui lòng thử lại.";

const MESSAGE_TRANSLATIONS: Record<string, string> = {
  "email is already in use": "Email này đã được sử dụng.",
  "firebase app check token is invalid": "Phiên xác thực ứng dụng không hợp lệ.",
  "firebase app check token is required": "Thiếu phiên xác thực ứng dụng.",
  "forbidden: insufficient permissions": "Bạn không có quyền thực hiện thao tác này.",
  "invalid request": "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.",
  "missing authentication session": "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  "request failed": "Yêu cầu chưa thực hiện được. Vui lòng thử lại.",
};

export const localizeErrorMessage = (
  message: string | null | undefined,
  fallback = DEFAULT_ERROR_MESSAGE,
) => {
  const trimmedMessage = message?.trim();
  if (!trimmedMessage) return fallback;

  return MESSAGE_TRANSLATIONS[trimmedMessage.toLowerCase()] ?? trimmedMessage;
};
