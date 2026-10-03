import { parseAmount } from '@/lib/validation';

export function parseUiAmount(value: string, decimals: number): bigint | undefined {
  try { return parseAmount(value, decimals); }
  catch { return undefined; }
}
