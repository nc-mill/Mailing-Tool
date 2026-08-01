export type CheckStatus = 'ok' | 'warn' | 'skip' | 'fail';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail?: string;
  readonly duration_ms?: number;
}

export type Check = () => Promise<CheckResult>;

export interface ReadinessResult {
  readonly status: 'ok' | 'fail';
  readonly httpStatus: 200 | 503;
  readonly checks: readonly CheckResult[];
}

export interface LivenessResult {
  readonly status: 'ok';
  readonly mode: string;
  readonly version: string;
}
