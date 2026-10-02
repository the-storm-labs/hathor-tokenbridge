/**
 * A decoded event field as a string. web3 decodes addresses and bytes as strings and uints as
 * bigints; anything else (absent, or an object) becomes `fallback` rather than "[object Object]".
 */
export function fieldString(value: unknown, fallback = ''): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value);
    default:
      return fallback;
  }
}
