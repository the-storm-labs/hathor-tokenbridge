/**
 * Time, as a dependency. Every wait in the application layer goes through this, so tests exercise
 * the retry logic without spending the retry delay.
 */
export interface ClockPort {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: ClockPort = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
