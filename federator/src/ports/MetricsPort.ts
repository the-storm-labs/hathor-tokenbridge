/**
 * Counters the federator publishes. Named after what happened rather than after the Prometheus
 * metric, so a use case reads as a description of events rather than of instrumentation.
 */
export interface MetricsPort {
  evmRunCompleted(): void;
  hathorRunCompleted(): void;

  voteSucceeded(): void;
  voteFailed(): void;

  proposalSubmitted(): void;
  proposalRejected(transactionHash: string): void;

  signatureSubmitted(): void;
  signatureRejected(): void;

  pushSubmitted(): void;
  pushRejected(): void;
}
