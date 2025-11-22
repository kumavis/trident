declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

describe("browser smoke test", () => {
  it("performs basic arithmetic", () => {
    const sum = 1 + 1;
    if (sum !== 2) {
      throw new Error("Math is broken");
    }
  });
});

