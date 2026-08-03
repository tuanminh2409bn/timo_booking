import { describe, expect, it } from "vitest";
import { isEmployeeRole } from "../../src/helpers/user-roles.js";

describe("user repository employee role helpers", () => {
  it("treats the employee role as a shop employee", () => {
    expect(isEmployeeRole("employee")).toBe(true);
    expect(isEmployeeRole("owner")).toBe(false);
    expect(isEmployeeRole("admin")).toBe(false);
  });
});
