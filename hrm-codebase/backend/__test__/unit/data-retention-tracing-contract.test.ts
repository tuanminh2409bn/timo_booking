import { describe, expect, it } from "vitest";
import {
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_ATTRIBUTE_KEYS,
  DATA_RETENTION_TRACE_EVENTS,
  DATA_RETENTION_TRACE_OPERATIONS,
  DATA_RETENTION_TRACE_SPANS,
  filterDataRetentionTraceAttributes,
} from "../../src/business/data-retention/data-retention-tracing-contract.js";

describe("data retention tracing contract", () => {
  it("keeps root, child, and event names unique and domain-scoped", () => {
    const names = [
      ...Object.values(DATA_RETENTION_TRACE_SPANS),
      ...Object.values(DATA_RETENTION_TRACE_CHILD_SPANS),
      ...Object.values(DATA_RETENTION_TRACE_EVENTS),
    ];

    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith("data_retention."))).toBe(true);
    expect(Object.keys(DATA_RETENTION_TRACE_OPERATIONS)).toEqual(
      Object.keys(DATA_RETENTION_TRACE_SPANS),
    );
  });

  it("keeps only safe allowlisted primitives and validated dates", () => {
    expect(
      filterDataRetentionTraceAttributes({
        "app.domain": "data_retention",
        "app.operation": "job_run",
        "app.store_id": "S-1",
        "actor.role": "system",
        "retention.execution_mode": "dry_run",
        "retention.plan": "standard",
        "retention.current_work_date": "2026-07-31",
        "retention.batch_size": 200,
        "retention.grace_period_active": true,
        "retention.candidate_count": 3,
        "owner.id": "owner-secret",
        "retention.raw_document": { ownerId: "owner-secret" },
        "retention.cache_key": "private-cache-key",
        "retention.money": 1200,
      }),
    ).toEqual({
      "app.domain": "data_retention",
      "app.operation": "job_run",
      "app.store_id": "S-1",
      "actor.role": "system",
      "retention.execution_mode": "dry_run",
      "retention.plan": "standard",
      "retention.current_work_date": "2026-07-31",
      "retention.batch_size": 200,
      "retention.grace_period_active": true,
      "retention.candidate_count": 3,
    });
  });

  it("rejects invalid dates, non-finite counts, and malformed categories", () => {
    expect(
      filterDataRetentionTraceAttributes({
        "retention.current_work_date": "31-07-2026",
        "retention.cutoff_work_date": "2026-02-30",
        "retention.batch_size": 201,
        "retention.candidate_count": -1,
        "retention.retry_count": Number.POSITIVE_INFINITY,
        "retention.store_count": Number.NaN,
        "retention.outcome": "raw-internal-error",
        "retention.failure_phase": "database",
        "retention.execution_mode": "production",
        "cache.status": "redis-secret-key",
      }),
    ).toEqual({});
  });

  it("keeps the attribute contract free of protected data", () => {
    for (const key of DATA_RETENTION_TRACE_ATTRIBUTE_KEYS) {
      const normalizedKey = key.toLowerCase();

      expect(normalizedKey).not.toMatch(/owner.*id|customer.*id|attendance.*id|employee.*id/);
      expect(normalizedKey).not.toMatch(/email|phone|token|password|authorization/);
      expect(normalizedKey).not.toMatch(/cache.*key|raw_document|payload|raw_error|error_message/);
      expect(normalizedKey).not.toMatch(/timestamp|created_at|updated_at/);
      expect(normalizedKey).not.toMatch(/amount|money|revenue|salary/);
    }
  });
});
