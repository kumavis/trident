import test from "node:test";
import { assertEqual } from "../shared/assert.ts";

void test("node smoke test", () => {
  assertEqual(1 + 1, 2, "math");
});

