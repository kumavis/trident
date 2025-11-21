import { QuickJsWasmRuntime } from "../../src/runtime/QuickJsWasmRuntime.ts";

declare const describe: (name: string, suite: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

describe("QuickJsWasmRuntime (browser)", () => {
  it("evaluates code snippets", async () => {
    const runtime = await QuickJsWasmRuntime.create();
    const resultJson = await runtime.evalUtf8("1 + 3");
    if (resultJson !== "4") {
      throw new Error(`Expected "4", received "${resultJson}"`);
    }
  });

  it("keeps global state between evaluations", async () => {
    const runtime = await QuickJsWasmRuntime.create();
    await runtime.evalUtf8("globalThis.answer = 40; 0;");
    const resultJson = await runtime.evalUtf8("globalThis.answer + 2");
    if (resultJson !== "42") {
      throw new Error(`Expected "42", received "${resultJson}"`);
    }
  });

  it("invokes named functions via callFunctionUtf8", async () => {
    const runtime = await QuickJsWasmRuntime.create();
    await runtime.evalUtf8("globalThis.increment = (n) => n + 1; 0;");
    const resultJson = await runtime.callFunctionUtf8("increment", JSON.stringify([4]));
    if (resultJson !== "5") {
      throw new Error(`Expected "5", received "${resultJson}"`);
    }
  });
});

