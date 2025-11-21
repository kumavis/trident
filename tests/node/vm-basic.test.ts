import test from "node:test";
import { vmBasicTestCases } from "../shared/vm-basic.ts";
import { vmForkTestCases } from "../shared/vm-fork.ts";

for (const testCase of [...vmBasicTestCases, ...vmForkTestCases]) {
  test(`Forkable VM (node) – ${testCase.name}`, async () => {
    await testCase.run();
  });
}

