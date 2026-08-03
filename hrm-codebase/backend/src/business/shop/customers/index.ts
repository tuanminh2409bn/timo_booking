import express from "express";
import { createPolicyRateLimit } from "../../../config/rate-limit-policies.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { getCustomerList } from "./get-customer-list.js";
import { getCustomerAttendanceHistory } from "./get-customer-attendance-history.js";
import { getCustomerAttendanceSummary } from "./get-customer-attendance-summary.js";
import { getCustomerDetail } from "./get-customer-detail.js";
import { blockCustomer } from "./patch-block-customer.js";
import { unblockCustomer } from "./patch-unblock-customer.js";

const customerRouter = express.Router();
const customerReadRateLimit = createPolicyRateLimit("read", {
  keyPrefix: "ratelimit:store:customer:read",
  message: "Too many customer API read requests",
});
const customerHeavyReadRateLimit = createPolicyRateLimit("heavyRead", {
  keyPrefix: "ratelimit:store:customer:heavy-read",
  message: "Too many customer history API requests",
});
const customerWriteRateLimit = createPolicyRateLimit("write", {
  keyPrefix: "ratelimit:store:customer:write",
  message: "Too many customer write requests",
});

customerRouter.get(
  "/api/v1/stores/:storeId/customers",
  customerReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      { eventName: "customer.list", route: "/api/v1/stores/:storeId/customers" },
      getCustomerList,
    ),
  ),
);
customerRouter.get(
  "/api/v1/stores/:storeId/customers/:customerId/attendances",
  customerHeavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "customer.attendance_history",
        route: "/api/v1/stores/:storeId/customers/:customerId/attendances",
      },
      getCustomerAttendanceHistory,
    ),
  ),
);
customerRouter.get(
  "/api/v1/stores/:storeId/customers/:customerId",
  customerReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      { eventName: "customer.detail", route: "/api/v1/stores/:storeId/customers/:customerId" },
      getCustomerDetail,
    ),
  ),
);
customerRouter.get(
  "/api/v1/stores/:storeId/customers/:customerId/attendance-summary",
  customerHeavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "customer.attendance_summary",
        route: "/api/v1/stores/:storeId/customers/:customerId/attendance-summary",
      },
      getCustomerAttendanceSummary,
    ),
  ),
);
customerRouter.patch(
  "/api/v1/stores/:storeId/customers/:customerId/block",
  customerWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      { eventName: "customer.block", route: "/api/v1/stores/:storeId/customers/:customerId/block" },
      blockCustomer,
    ),
  ),
);
customerRouter.patch(
  "/api/v1/stores/:storeId/customers/:customerId/unblock",
  customerWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "customer.unblock",
        route: "/api/v1/stores/:storeId/customers/:customerId/unblock",
      },
      unblockCustomer,
    ),
  ),
);

export default customerRouter;
