import type { ClockPort } from '../ports/ClockPort';

/**
 * Real time. Lives in infra rather than beside the port: a port describes what the application
 * needs, and shipping an implementation next to it means the layer that is supposed to be free of
 * I/O carries some.
 */
export const systemClock: ClockPort = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
