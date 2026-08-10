export function getEcodeApiError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  if (record.api_status !== false) return undefined;
  return typeof record.msg === 'string' && record.msg ? record.msg : 'Request failed';
}

export function throwIfEcodeApiFailed(payload: unknown): void {
  const message = getEcodeApiError(payload);
  if (message) throw new Error(message);
}
