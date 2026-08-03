import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { deleteShopService } from "./delete-shop-service.js";
import { listShopServices } from "./get-shop-service.js";
import { getShopServiceCatalog } from "./get-shop-service-catalog.js";
import { updateShopService } from "./patch-update-shop-service.js";
import { createShopService } from "./post-create-shop-service.js";
import { createShopServiceGroup } from "./post-create-shop-service-group.js";
import { shopReadRateLimit, shopWriteRateLimit } from "../shop-rate-limits.js";

const SERVICE_ROUTES = {
  serviceGroups: "/api/v1/stores/:storeId/service-groups",
  services: "/api/v1/stores/:storeId/services",
  serviceCatalog: "/api/v1/stores/:storeId/service-catalog",
  serviceDetail: "/api/v1/stores/:storeId/services/:serviceId",
};

const serviceRouter = express.Router();
serviceRouter.post(
  SERVICE_ROUTES.serviceGroups,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.service_group.create",
        route: SERVICE_ROUTES.serviceGroups,
      },
      createShopServiceGroup,
    ),
  ),
);
serviceRouter.post(
  SERVICE_ROUTES.services,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.service.create",
        route: SERVICE_ROUTES.services,
      },
      createShopService,
    ),
  ),
);
serviceRouter.get(
  SERVICE_ROUTES.serviceCatalog,
  shopReadRateLimit,
  handleErrorFunction(getShopServiceCatalog),
);
serviceRouter.get(
  SERVICE_ROUTES.services,
  shopReadRateLimit,
  handleErrorFunction(listShopServices),
);
serviceRouter.patch(
  SERVICE_ROUTES.serviceDetail,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.service.update",
        route: SERVICE_ROUTES.serviceDetail,
      },
      updateShopService,
    ),
  ),
);
serviceRouter.delete(
  SERVICE_ROUTES.serviceDetail,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.service.delete",
        route: SERVICE_ROUTES.serviceDetail,
      },
      deleteShopService,
    ),
  ),
);

export default serviceRouter;
