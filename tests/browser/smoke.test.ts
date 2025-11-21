declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

describe("browser smoke test", () => {
  it("performs basic arithmetic", () => {
    if (1 + 1 !== 2) {
      throw new Error("Math is broken");
    }
  });
});

