import { AsyncLocalStorage } from "node:async_hooks";

// Context sống theo vòng đời 1 request. Middleware tạo store lúc vào; verify-* ghi danh tính
// người gọi vào đây (chúng không có `res`); logger đọc ra để mọi dòng log tự mang uid —
// kể cả lỗi throw không bắt đi qua error middleware.
export type RequestContext = {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  uid?: string;
  role?: string;
  dependencyFailures?: Array<{
    dependency: "redis" | "firestore" | "firebase" | "other";
    operation: string;
    message: string;
  }>;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  requestContextStorage.run(context, fn);

export const getRequestContext = (): RequestContext | undefined => requestContextStorage.getStore();

// Ghi danh tính người gọi đã xác thực vào context hiện tại. Gọi từ verify-* sau khi verify xong.
export const setRequestContextIdentity = (uid: string, role?: string) => {
  const context = requestContextStorage.getStore();

  if (!context) {
    return;
  }

  context.uid = uid;

  if (role !== undefined) {
    context.role = role;
  }
};
