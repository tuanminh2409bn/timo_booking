import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { addUtcCalendarMonths } from "../../helpers/data-retention.js";
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
  ownerDataRetentionPolicyNeedsInitialization,
  resolveOwnerDataRetentionPlanResponse,
} from "./data-retention-plan-shared.js";

const SERVICE_ERRORS = {
  forbidden: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/account/data-retention-plan/forbidden",
    message: "Only owners can manage the data retention plan",
  },
};

export const getDataRetentionPlan = async (
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

  if (authContext.role !== "owner") {
    setDataRetentionTraceOutcome(res, "forbidden_role");
    return createErrorResponse(res, SERVICE_ERRORS.forbidden);
  }

  let owner: Awaited<ReturnType<typeof firestoreRepository.user.getUser>>;

  try {
    owner = await withDataRetentionSpan(DATA_RETENTION_TRACE_CHILD_SPANS.policyLoad, {}, () =>
      firestoreRepository.user.getUser(authContext.uid),
    );
  } catch (error) {
    markDataRetentionDependencyFailure(res, "policy_load");
    throw error;
  }

  if (owner.role !== "owner") {
    setDataRetentionTraceOutcome(res, "forbidden_role");
    return createErrorResponse(res, SERVICE_ERRORS.forbidden);
  }

  const timestamp = Date.now();
  let ownerPolicy = owner as OwnerUserType;
  const plan = ownerPolicy.dataRetentionPlan ?? "standard";

  setActiveDataRetentionSpanAttributes({ "retention.plan": plan });

  if (ownerDataRetentionPolicyNeedsInitialization(ownerPolicy)) {
    const policyTrace = createDataRetentionPolicyWriteTrace(res, plan, false, "policy_initialized");

    try {
      ownerPolicy = await withDataRetentionSpan(
        DATA_RETENTION_TRACE_CHILD_SPANS.policyInitialize,
        { "retention.plan": plan },
        async () => {
          await firestoreRepository.maintenance.updateOwnerDataRetentionPolicy(
            ownerPolicy.uid,
            {
              dataRetentionPlan: plan,
              dataRetentionPlanChangedAt: ownerPolicy.dataRetentionPlanChangedAt ?? timestamp,
              dataRetentionStandardEligibleAt:
                plan === "premium"
                  ? undefined
                  : (ownerPolicy.dataRetentionStandardEligibleAt ??
                    addUtcCalendarMonths(timestamp, 2)),
              updatedAt: timestamp,
              updatedByUserId: authContext.uid,
            },
            policyTrace.options,
          );

          return (await firestoreRepository.user.getUser(authContext.uid)) as OwnerUserType;
        },
      );
    } catch (error) {
      if (policyTrace.state.committed && policyTrace.state.cacheInvalidated) {
        markDataRetentionPostWriteFailure(res, "policy_load", "cache_invalidation");
      } else {
        markDataRetentionPolicyWriteFailure(res, policyTrace, "policy_initialize");
      }

      throw error;
    }
  }

  return res
    .status(StatusCodes.OK)
    .json(resolveOwnerDataRetentionPlanResponse(ownerPolicy, timestamp));
};
