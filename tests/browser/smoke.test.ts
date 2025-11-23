import { assertEqual } from "../shared/assert.ts";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

describe("browser smoke test", () => {
  it("performs basic arithmetic", () => {
    const sum = 1 + 1;
    assertEqual(sum, 2, "math");
  });
});

