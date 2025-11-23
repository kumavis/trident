export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, received ${String(actual)}`);
  }
}

export function assertTruthy(value: unknown, label: string): void {
  if (!value) {
    throw new Error(`${label} expected truthy value, received ${String(value)}`);
  }
}


