import test from "node:test";
import { vmBasicTestCases } from "../shared/vm-basic.ts";
import { vmForkTestCases } from "../shared/vm-fork.ts";
import { vmIdentityTestCases } from "../shared/vm-identity.ts";

for (const testCase of [...vmBasicTestCases, ...vmIdentityTestCases, ...vmForkTestCases]) {
  void test(`Forkable VM (node) – ${testCase.name}`, async () => {
    await testCase.run();
  });
}

