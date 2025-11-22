import assert from "node:assert/strict";
import test from "node:test";
import { QuickJsWasmRuntime } from "../../src/runtime/QuickJsWasmRuntime.ts";

void test("QuickJsWasmRuntime evalUtf8 evaluates code", async () => {
  const runtime = await QuickJsWasmRuntime.create();
  const resultJson = runtime.evalUtf8("1 + 2");
  assert.equal(resultJson, "3");
});

void test("QuickJsWasmRuntime retains global state between evals", async () => {
  const runtime = await QuickJsWasmRuntime.create();
  runtime.evalUtf8("globalThis.foo = 41; 0;");
  const resultJson = runtime.evalUtf8("globalThis.foo + 1");
  assert.equal(resultJson, "42");
});

void test("QuickJsWasmRuntime callFunctionUtf8 invokes named function", async () => {
  const runtime = await QuickJsWasmRuntime.create();
  runtime.evalUtf8("globalThis.double = (value) => value * 2; 0;");
  const resultJson = runtime.callFunctionUtf8("double", JSON.stringify([21]));
  assert.equal(resultJson, "42");
});

