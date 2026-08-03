import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { addUtcCalendarMonths } from "../../helpers/data-retention.js";
import { writeShopAuditLog } from "../../helpers/shop-audit-log.js";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import type { OwnerUserType } from "../../repository/firestore/user/user.types.js";
import {
  markDataRetentionDependencyFailure,
  markDataRetentionPostWriteFailure,
  setActiveDataRetentionSpanAttributes,
  setDataRetentionLastCommittedStage,
  setDataRetentionTraceOutcome,
  withDataRetentionSpan,
} from "../data-retention/data-retention-observability.js";
import { DATA_RETENTION_TRACE_CHILD_SPANS } from "../data-retention/data-retention-tracing-contract.js";
import {
  createDataRetentionPolicyWriteTrace,
  markDataRetentionPolicyWriteFailure,
} from "./data-retention-plan-tracing.js";
import {
  type DataRetentionPlanResponse,
  resolveOwnerDataRetentionPlanResponse,
  updateDataRetentionPlanSchema,
} from "./data-retention-plan-shared.js";

const SERVICE_ERRORS = {
  forbidden: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/account/data-retention-plan/forbidden",
    message: "Only owners can manage the data retention plan",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/account/data-retention-plan/invalid-request",
    message: "Invalid data retention plan",
  },
  paymentRequired: {
    statusCode: StatusCodes.PAYMENT_REQUIRED,
    type: "/account/data-retention-plan/payment-required",
    message: "Premium must be activated through an approved billing subscription",
  },
};

export const updateDataRetentionPlan = async (
  req: Request,
  res: Response<DataRetentionPlanResponse | ErrorResponseBodyType>,
) => {
  let authContext: Awaited<ReturnType<typeof verifyAuthorizationHeader>>;

  try {
    authContext = await withDataRetentionSpan(
      DATA_RETENTION_TRACE_CHILD_SPANS.scopeResolve,
      {},
      () => verifyAuthorizationHeader(req.headers["authorization"]),
    );
  } catch (error) {
    markDataRetentionDependencyFailure(res, "auth");
    throw error;
  }

  const parseResult = updateDataRetentionPlanSchema.safeParse(req.body);

  if (authContext.role !== "owner") {
    setDataRetentionTraceOutcome(res, "forbidden_role");
    return createErrorResponse(res, SERVICE_ERRORS.forbidden);
  }

  if (!parseResult.success) {
    setDataRetentionTraceOutcome(res, "invalid_payload");
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest);
  }

  if (parseResult.data.plan === "premium") {
    setDataRetentionTraceOutcome(res, "payment_required");
    return createErrorResponse(res, SERVICE_ERRORS.paymentRequired);
  }

  let currentUser: Awaited<ReturnType<typeof firestoreRepository.user.getUser>>;

  try {
    currentUser = await withDataRetentionSpan(DATA_RETENTION_TRACE_CHILD_SPANS.policyLoad, {}, () =>
      firestoreRepository.user.getUser(authContext.uid),
    );
  } catch (error) {
    markDataRetentionDependencyFailure(res, "policy_load");
    throw error;
  }

  if (currentUser.role !== "owner") {
    setDataRetentionTraceOutcome(res, "forbidden_role");
    return createErrorResponse(res, SERVICE_ERRORS.forbidden);
  }

  const timestamp = Date.now();
  const previousPlan = currentUser.dataRetentionPlan ?? "standard";
  const nextPlan = parseResult.data.plan;
  const planChanged = previousPlan !== nextPlan;

  setActiveDataRetentionSpanAttributes({
    "retention.plan": nextPlan,
    "retention.plan_changed": planChanged,
  });

  const policyIsAlreadyComplete =
    currentUser.dataRetentionPlan === "standard" &&
    currentUser.dataRetentionPlanChangedAt !== undefined &&
    currentUser.dataRetentionStandardEligibleAt !== undefined;

  if (policyIsAlreadyComplete) {
    setDataRetentionTraceOutcome(res, "idempotent_replay");
    return res
      .status(StatusCodes.OK)
      .json(resolveOwnerDataRetentionPlanResponse(currentUser as OwnerUserType, timestamp));
  }

  const standardRetentionEligibleAt = addUtcCalendarMonths(timestamp, 2);

  const policyTrace = createDataRetentionPolicyWriteTrace(
    res,
    nextPlan,
    planChanged,
    "policy_updated",
  );

  try {
    await withDataRetentionSpan(
      DATA_RETENTION_TRACE_CHILD_SPANS.policyPersist,
      {
        "retention.plan": nextPlan,
        "retention.plan_changed": planChanged,
      },
      () =>
        firestoreRepository.maintenance.updateOwnerDataRetentionPolicy(
          currentUser.uid,
          {
            dataRetentionPlan: nextPlan,
            dataRetentionPlanChangedAt: timestamp,
            dataRetentionStandardEligibleAt: standardRetentionEligibleAt,
            updatedAt: timestamp,
            updatedByUserId: authContext.uid,
          },
          policyTrace.options,
        ),
    );
  } catch (error) {
    markDataRetentionPolicyWriteFailure(res, policyTrace, "policy_persist");
    throw error;
  }

  if (planChanged) {
    try {
      await withDataRetentionSpan(
        DATA_RETENTION_TRACE_CHILD_SPANS.auditWrite,
        { "retention.plan_changed": true },
        () =>
          writeShopAuditLog({
            ownerId: authContext.ownerId,
            eventType: "owner_data_retention_plan_changed",
            entityType: "owner",
            entityId: currentUser.uid,
            actor: {
              uid: authContext.uid,
              role: authContext.role,
            },
            metadata: {
              previousPlan,
              nextPlan,
              ...(standardRetentionEligibleAt !== undefined && {
                standardRetentionEligibleAt,
              }),
            },
          }),
      );
      setDataRetentionLastCommittedStage(res, "audit");
    } catch (error) {
      markDataRetentionPostWriteFailure(res, "audit", "policy_updated");
      throw error;
    }
  }

  let updatedOwner: Awaited<ReturnType<typeof firestoreRepository.user.getUser>>;

  try {
    updatedOwner = await withDataRetentionSpan(
      DATA_RETENTION_TRACE_CHILD_SPANS.policyLoad,
      { "retention.plan": nextPlan },
      () => firestoreRepository.user.getUser(currentUser.uid),
    );
  } catch (error) {
    markDataRetentionPostWriteFailure(
      res,
      "policy_load",
      planChanged ? "audit" : "cache_invalidation",
    );
    throw error;
  }

  return res
    .status(StatusCodes.OK)
    .json(resolveOwnerDataRetentionPlanResponse(updatedOwner as OwnerUserType, timestamp));
};
