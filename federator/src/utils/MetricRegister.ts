import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

class MetricRegister {
  private evmFederationRunCounter = new Counter({
    name: 'evm_run_count',
    help: 'Counter of EVM federation runs.',
  });

  private htrFederationRunCounter = new Counter({
    name: 'htr_run_count',
    help: 'Counter of Hathor federation runs.',
  });

  private successVoteCounter = new Counter({
    name: 'success_vote_count',
    help: 'Counter of successful votes'
  });

  private failedVoteCounter = new Counter({
    name: 'failed_vote_count',
    help: 'Counter of failed votes',
  });

  private invalidProposalCounter = new Counter({
    name: 'invalid_proposal_count',
    help: 'Counter of invalid proposals',
  });

  private proposalCounter = new Counter({
    name: 'successful_proposal_count',
    help: 'Counter of proposals',
  });

  private invalidSigningCounter = new Counter({
    name: 'invalid_signing_count',
    help: 'Counter of signatures',
  });

  private signingCounter = new Counter({
    name: 'signing_count',
    help: 'Counter of signatures',
  });

  private invalidPushedProposalCounter = new Counter({
    name: 'invalid_pushed_proposal_count',
    help: 'Counter of proposals pushed',
  });

  private pushedProposalCounter = new Counter({
    name: 'pushed_proposal_count',
    help: 'Counter of proposals pushed',
  });

  constructor(register: Registry, prefix: string) {
    register.registerMetric(this.evmFederationRunCounter);
    register.registerMetric(this.htrFederationRunCounter);
    register.registerMetric(this.successVoteCounter);
    register.registerMetric(this.failedVoteCounter);
    register.registerMetric(this.invalidProposalCounter);
    register.registerMetric(this.proposalCounter);
    register.registerMetric(this.signingCounter);
    register.registerMetric(this.pushedProposalCounter);
    collectDefaultMetrics({ register, prefix });
  }

  increaseEvmRunCounter() {
    this.evmFederationRunCounter.inc();
  }

  increaseHtrRunCounter() {
    this.htrFederationRunCounter.inc();
  }

  increaseSuccessfulVoteCounter() {
    this.successVoteCounter.inc();
  }

  increaseFailedVoteCounter() {
    this.failedVoteCounter.inc();
  }

  increaseInvalidProposalCounter(transactionHash: string) {
    this.invalidProposalCounter.inc();
  }

  increaseSuccessfulProposalCounter() {
    this.proposalCounter.inc();
  }

  increaseInvalidSigningCounter() {
    this.invalidSigningCounter.inc();
  }

  increaseSigningCounter() {
    this.signingCounter.inc();
  }

  increaseInvalidPushProposalCounter() {
    this.invalidPushedProposalCounter.inc();
  }

  increasePushProposalCounter() {
    this.pushedProposalCounter.inc();
  }
}

export default MetricRegister;
