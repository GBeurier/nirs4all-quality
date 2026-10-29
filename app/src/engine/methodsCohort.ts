// These diagnostics require the owner kernel's wide-matrix fix.
export const METHODS_MINIMUM_VERSION = '1.3.9';
export const METHODS_MINIMUM_ABI = [2, 20, 0] as const;

export function assertMethodsRuntime(version: string, abi: readonly number[]): void {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version);
  const parsed = match?.slice(1).map(Number);
  const compatibleVersion = parsed && parsed[0] === 1 &&
    (parsed[1]! > 3 || parsed[1] === 3 && parsed[2]! >= 9);
  const compatibleAbi = abi.length === 3 && abi.every(value => Number.isInteger(value) && value >= 0) &&
    abi[0] === METHODS_MINIMUM_ABI[0] && abi[1]! >= METHODS_MINIMUM_ABI[1];
  if (!compatibleVersion || !compatibleAbi) {
    throw new Error(`Quality requires Methods >=${METHODS_MINIMUM_VERSION} <2 with ABI >=2.20 <3; loaded ${version || 'unknown'} / ABI ${abi.join('.') || 'unknown'}. Stage the qualified owner artifact before building or running.`);
  }
}
