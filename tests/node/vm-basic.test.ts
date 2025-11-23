import test from "node:test";
import { vmBasicTestCases } from "../shared/vm-basic.ts";
import { vmForkTestCases } from "../shared/vm-fork.ts";
import { vmIdentityTestCases } from "../shared/vm-identity.ts";
import { vmQuirkTestCases } from "../shared/vm-quirks.ts";
import { vmMeteringTestCases } from "../shared/vm-metering.ts";
import { vmCycleCountTestCases } from "../shared/vm-cycle-counts.ts";

for (const testCase of [
  ...vmBasicTestCases,
  ...vmIdentityTestCases,
  ...vmQuirkTestCases,
  ...vmForkTestCases,
  ...vmMeteringTestCases,
  ...vmCycleCountTestCases,
]) {
  void test(`Forkable VM (node) – ${testCase.name}`, async () => {
    await testCase.run();
  });
}

