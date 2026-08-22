export type SmartBookingWorkerType = "main" | "assistant";

export type SmartBookingEmployee = {
  employeeUserId: string;
  workerType: SmartBookingWorkerType;
  serviceIds?: readonly string[];
};

export type SmartBookingServiceSegment = {
  segmentId: string;
  sourceServiceId: string;
  durationMinutes: number;
  preferredWorkerType: SmartBookingWorkerType;
  fixedEmployeeUserId?: string;
};

export type SmartBookingBusyInterval = {
  employeeUserId: string;
  startTime: number;
  endTime: number;
  bookingKey: string;
};

export type SmartBookingAssignment = {
  segmentId: string;
  employeeUserId: string;
  startTime: number;
  endTime: number;
};

type SmartBookingPlanScore = {
  preferenceMismatchCount: number;
  employeeCount: number;
  reorderDistance: number;
  wholeDayLoadPenalty: number;
  placementPenalty: number;
  signature: string;
};

type SmartBookingCandidatePlan = {
  assignments: SmartBookingAssignment[];
  score: SmartBookingPlanScore;
};

type PlanSmartAnyStaffBookingInput = {
  startTime: number;
  segments: readonly SmartBookingServiceSegment[];
  employees: readonly SmartBookingEmployee[];
  busyIntervals: readonly SmartBookingBusyInterval[];
  allowServiceReordering: boolean;
  isEmployeeAvailable: (
    employeeUserId: string,
    startTime: number,
    endTime: number,
  ) => boolean;
};

const overlaps = (
  left: Pick<SmartBookingBusyInterval, "startTime" | "endTime">,
  right: Pick<SmartBookingBusyInterval, "startTime" | "endTime">,
): boolean => left.startTime < right.endTime && left.endTime > right.startTime;

const canPerformService = (
  employee: SmartBookingEmployee,
  segment: SmartBookingServiceSegment,
): boolean =>
  employee.serviceIds === undefined ||
  employee.serviceIds.length === 0 ||
  employee.serviceIds.includes(segment.sourceServiceId);

const createPermutations = <Item>(items: readonly Item[]): Item[][] => {
  if (items.length <= 1) return [[...items]];

  return items.flatMap((item, index) =>
    createPermutations(items.filter((_, candidateIndex) => candidateIndex !== index)).map(
      (tail) => [item, ...tail],
    ),
  );
};

const compareScores = (left: SmartBookingPlanScore, right: SmartBookingPlanScore): number => {
  const numericKeys: Array<keyof Omit<SmartBookingPlanScore, "signature">> = [
    "preferenceMismatchCount",
    "employeeCount",
    "reorderDistance",
    "wholeDayLoadPenalty",
    "placementPenalty",
  ];
  for (const key of numericKeys) {
    const difference = left[key] - right[key];
    if (difference !== 0) return difference;
  }
  return left.signature.localeCompare(right.signature);
};

const getGapPenalty = (
  employeeUserId: string,
  startTime: number,
  endTime: number,
  busyIntervals: readonly SmartBookingBusyInterval[],
): number => {
  const intervals = busyIntervals
    .filter((interval) => interval.employeeUserId === employeeUserId)
    .slice()
    .sort((left, right) => left.startTime - right.startTime);
  const previousEnd = intervals.filter((interval) => interval.endTime <= startTime).at(-1)?.endTime;
  const nextStart = intervals.find((interval) => interval.startTime >= endTime)?.startTime;

  if (previousEnd === undefined && nextStart === undefined) return 1_440;
  return (previousEnd === undefined ? 720 : startTime - previousEnd) +
    (nextStart === undefined ? 720 : nextStart - endTime);
};

const scorePlan = (
  assignments: readonly SmartBookingAssignment[],
  orderedSegments: readonly SmartBookingServiceSegment[],
  originalSegmentIndex: ReadonlyMap<string, number>,
  employeeMap: ReadonlyMap<string, SmartBookingEmployee>,
  busyIntervals: readonly SmartBookingBusyInterval[],
): SmartBookingPlanScore => {
  const employeeIds = new Set(assignments.map((assignment) => assignment.employeeUserId));
  const bookingKeysByEmployee = new Map<string, Set<string>>();
  const bookedMinutesByEmployee = new Map<string, number>();
  for (const interval of busyIntervals) {
    const bookingKeys = bookingKeysByEmployee.get(interval.employeeUserId) ?? new Set<string>();
    bookingKeys.add(interval.bookingKey);
    bookingKeysByEmployee.set(interval.employeeUserId, bookingKeys);
    bookedMinutesByEmployee.set(
      interval.employeeUserId,
      (bookedMinutesByEmployee.get(interval.employeeUserId) ?? 0) +
        Math.max(interval.endTime - interval.startTime, 0),
    );
  }

  let preferenceMismatchCount = 0;
  let placementPenalty = 0;
  for (const [index, assignment] of assignments.entries()) {
    const segment = orderedSegments[index];
    const employee = employeeMap.get(assignment.employeeUserId);
    if (!segment || !employee) continue;
    if (segment.preferredWorkerType !== employee.workerType) preferenceMismatchCount += 1;

    placementPenalty += getGapPenalty(
      assignment.employeeUserId,
      assignment.startTime,
      assignment.endTime,
      busyIntervals,
    );
  }

  for (const employeeUserId of employeeIds) {
    // One existing booking is roughly half a working block. This still lets a
    // directly adjacent appointment win over an idle employee, but rotates to
    // the less-loaded employee once a lane is materially fuller.
    placementPenalty += (bookingKeysByEmployee.get(employeeUserId)?.size ?? 0) * 360;
    placementPenalty += bookedMinutesByEmployee.get(employeeUserId) ?? 0;
  }

  const reorderDistance = orderedSegments.reduce(
    (total, segment, index) => total + Math.abs((originalSegmentIndex.get(segment.segmentId) ?? index) - index),
    0,
  );
  const wholeDayLoadPenalty = assignments.length === 1
    ? Array.from(employeeIds).reduce(
        (total, employeeUserId) =>
          total + (bookingKeysByEmployee.get(employeeUserId)?.size ?? 0) * 1_440 +
          (bookedMinutesByEmployee.get(employeeUserId) ?? 0),
        0,
      )
    : 0;

  return {
    preferenceMismatchCount,
    employeeCount: employeeIds.size,
    reorderDistance,
    wholeDayLoadPenalty,
    placementPenalty,
    signature: assignments
      .map((assignment, index) => {
        const segment = orderedSegments[index];
        return `${segment ? originalSegmentIndex.get(segment.segmentId) ?? index : index}:${assignment.employeeUserId}`;
      })
      .join("|"),
  };
};

/**
 * Plans one Any-staff booking against the complete store-day workload.
 *
 * Services may be reordered only when every segment is Any staff. The search
 * is intentionally exhaustive because public bookings contain at most three
 * main services, keeping the result deterministic and easy to verify.
 */
export const planSmartAnyStaffBooking = (
  input: PlanSmartAnyStaffBookingInput,
): SmartBookingAssignment[] | undefined => {
  if (input.segments.length === 0 || input.employees.length === 0) return undefined;

  const employeeMap = new Map(
    input.employees.map((employee) => [employee.employeeUserId, employee]),
  );
  const originalSegmentIndex = new Map(
    input.segments.map((segment, index) => [segment.segmentId, index]),
  );
  const segmentOrders = input.allowServiceReordering
    ? createPermutations(input.segments)
    : [[...input.segments]];
  let bestPlan: SmartBookingCandidatePlan | undefined;

  for (const orderedSegments of segmentOrders) {
    const plannedIntervals: SmartBookingAssignment[] = [];

    const searchAssignments = (segmentIndex: number, cursor: number): void => {
      if (segmentIndex === orderedSegments.length) {
        const score = scorePlan(
          plannedIntervals,
          orderedSegments,
          originalSegmentIndex,
          employeeMap,
          input.busyIntervals,
        );
        if (bestPlan === undefined || compareScores(score, bestPlan.score) < 0) {
          bestPlan = { assignments: plannedIntervals.map((assignment) => ({ ...assignment })), score };
        }
        return;
      }

      const segment = orderedSegments[segmentIndex];
      if (!segment) return;
      const endTime = cursor + segment.durationMinutes;
      const eligibleEmployees = input.employees
        .filter((employee) =>
          (segment.fixedEmployeeUserId === undefined ||
            segment.fixedEmployeeUserId === employee.employeeUserId) &&
          canPerformService(employee, segment) &&
          input.isEmployeeAvailable(employee.employeeUserId, cursor, endTime) &&
          !input.busyIntervals.some(
            (interval) =>
              interval.employeeUserId === employee.employeeUserId &&
              overlaps(interval, { startTime: cursor, endTime }),
          ) &&
          !plannedIntervals.some(
            (interval) =>
              interval.employeeUserId === employee.employeeUserId &&
              overlaps(interval, { startTime: cursor, endTime }),
          ),
        )
        .sort((left, right) => left.employeeUserId.localeCompare(right.employeeUserId));

      for (const employee of eligibleEmployees) {
        plannedIntervals.push({
          segmentId: segment.segmentId,
          employeeUserId: employee.employeeUserId,
          startTime: cursor,
          endTime,
        });
        searchAssignments(segmentIndex + 1, endTime);
        plannedIntervals.pop();
      }
    };

    searchAssignments(0, input.startTime);
  }

  return bestPlan?.assignments;
};
