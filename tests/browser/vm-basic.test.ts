import { vmBasicTestCases } from "../shared/vm-basic.ts";
import { vmForkTestCases } from "../shared/vm-fork.ts";

declare const describe: (name: string, suite: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

describe("Forkable VM (browser)", () => {
  for (const testCase of [...vmBasicTestCases, ...vmForkTestCases]) {
    it(testCase.name, async () => {
      await testCase.run();
    });
  }
});

