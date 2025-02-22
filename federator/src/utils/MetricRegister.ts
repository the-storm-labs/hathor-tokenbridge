import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

class MetricRegister {
  private federatorAddress = process.env.FEDERATOR_ADDRESS;

  private evmFederationRunCounter = new Counter({
    name: 'evm_run_count',
    help: 'Counter of EVM federation runs.',
    labelNames: ['federator', 'start_block', 'end_block'],
  });

  private htrFederationRunCounter = new Counter({
    name: 'htr_run_count',
    help: 'Counter of Hathor federation runs.',
    labelNames: ['federator', 'start_block', 'end_block'],
  });

  private successVoteCounter = new Counter({
    name: 'success_vote_count',
    help: 'Counter of successful votes',
    labelNames: [
      'transactionHash',
      'federator',
      'blockHash',
      'transactionId',
      'originalTokenAddress',
      'receiver',
      'amount',
    ],
  });

  private failedVoteCounter = new Counter({
    name: 'failed_vote_count',
    help: 'Counter of failed votes',
    labelNames: [
      'transactionHash',
      'federator',
      'blockHash',
      'transactionId',
      'originalTokenAddress',
      'receiver',
      'amount',
    ],
  });

  private invalidProposalCounter = new Counter({
    name: 'invalid_proposal_count',
    help: 'Counter of invalid proposals',
    labelNames: ['transactionHash', 'federator'],
  });

  private proposalCounter = new Counter({
    name: 'successful_proposal_count',
    help: 'Counter of proposals',
    labelNames: [
      'status',
      'transactionHash',
      'federator',
      'transactionId',
      'originalTokenAddress',
      'sender',
      'receiver',
      'amount',
      'txHex',
    ],
  });

  private invalidSigningCounter = new Counter({
    name: 'invalid_signing_count',
    help: 'Counter of signatures',
    labelNames: [
      'transactionHash',
      'federator',
      'transactionId',
      'originalTokenAddress',
      'sender',
      'receiver',
      'amount',
      'txHex',
    ],
  });

  private signingCounter = new Counter({
    name: 'signing_count',
    help: 'Counter of signatures',
    labelNames: [
      'transactionHash',
      'federator',
      'transactionId',
      'originalTokenAddress',
      'sender',
      'receiver',
      'amount',
      'txHex',
    ],
  });

  private invalidPushedProposalCounter = new Counter({
    name: 'invalid_pushed_proposal_count',
    help: 'Counter of proposals pushed',
    labelNames: [
      'transactionHash',
      'federator',
      'transactionId',
      'originalTokenAddress',
      'sender',
      'receiver',
      'amount',
      'txHex',
    ],
  });

  private pushedProposalCounter = new Counter({
    name: 'pushed_proposal_count',
    help: 'Counter of proposals pushed',
    labelNames: [
      'transactionHash',
      'federator',
      'transactionId',
      'originalTokenAddress',
      'sender',
      'receiver',
      'amount',
      'txHex',
    ],
  });

  constructor(register: Registry) {
    register.registerMetric(this.evmFederationRunCounter);
    register.registerMetric(this.htrFederationRunCounter);
    register.registerMetric(this.successVoteCounter);
    register.registerMetric(this.failedVoteCounter);
    register.registerMetric(this.invalidProposalCounter);
    register.registerMetric(this.proposalCounter);
    register.registerMetric(this.signingCounter);
    register.registerMetric(this.pushedProposalCounter);
    collectDefaultMetrics({ register });
  }

  increaseEvmRunCounter(startBlock: number, endBlock: number) {
    this.evmFederationRunCounter
      .labels({
        federator: this.federatorAddress,
        start_block: startBlock,
        end_block: endBlock,
      })
      .inc();
  }

  increaseHtrRunCounter(startBlock: number, endBlock: number) {
    this.htrFederationRunCounter
      .labels({
        federator: this.federatorAddress,
        start_block: startBlock,
        end_block: endBlock,
      })
      .inc();
  }

  increaseSuccessfulVoteCounter(
    transactionHash: string,
    blockHash: string,
    transactionId: string,
    originalTokenAddress: string,
    receiver: string,
    amount: string,
  ) {
    this.successVoteCounter
      .labels({
        transactionHash,
        federator: this.federatorAddress,
        blockHash,
        transactionId,
        originalTokenAddress,
        receiver,
        amount,
      })
      .inc();
  }

  increaseFailedVoteCounter(
    transactionHash: string,
    blockHash: string,
    transactionId: string,
    originalTokenAddress: string,
    receiver: string,
    amount: string,
  ) {
    this.failedVoteCounter
      .labels({
        transactionHash,
        federator: this.federatorAddress,
        blockHash,
        transactionId,
        originalTokenAddress,
        receiver,
        amount,
      })
      .inc();
  }

  increaseInvalidProposalCounter(transactionHash: string) {
    this.invalidProposalCounter.labels({ federator: this.federatorAddress, transactionHash: transactionHash }).inc();
  }

  increaseSuccessfulProposalCounter(
    transactionHash: string,
    transactionId: string,
    originalTokenAddress: string,
    sender: string,
    receiver: string,
    amount: string,
    txHex: string,
  ) {
    this.proposalCounter
      .labels({
        transactionHash,
        federator: this.federatorAddress,
        transactionId,
        originalTokenAddress,
        sender,
        receiver,
        amount,
        txHex,
      })
      .inc();
  }

  increaseInvalidSigningCounter(
    transactionHash: string,
    transactionId: string,
    originalTokenAddress: string,
    sender: string,
    receiver: string,
    amount: string,
    txHex: string,
  ) {
    this.invalidSigningCounter
      .labels({
        transactionHash,
        federator: this.federatorAddress,
        transactionId,
        originalTokenAddress,
        sender,
        receiver,
        amount,
        txHex,
      })
      .inc();
  }

  increaseSigningCounter(
    transactionHash: string,
    transactionId: string,
    originalTokenAddress: string,
    sender: string,
    receiver: string,
    amount: string,
    txHex: string,
  ) {
    this.signingCounter
      .labels({
        transactionHash,
        federator: this.federatorAddress,
        transactionId,
        originalTokenAddress,
        sender,
        receiver,
        amount,
        txHex,
      })
      .inc();
  }

  increaseInvalidPushProposalCounter(
    transactionHash: string,
    transactionId: string,
    originalTokenAddress: string,
    sender: string,
    receiver: string,
    amount: string,
    txHex: string,
  ) {
    this.invalidPushedProposalCounter
      .labels({
        transactionHash,
        federator: this.federatorAddress,
        transactionId,
        originalTokenAddress,
        sender,
        receiver,
        amount,
        txHex,
      })
      .inc();
  }

  increasePushProposalCounter(
    transactionHash: string,
    transactionId: string,
    originalTokenAddress: string,
    sender: string,
    receiver: string,
    amount: string,
    txHex: string,
  ) {
    this.pushedProposalCounter
      .labels({
        transactionHash,
        federator: this.federatorAddress,
        transactionId,
        originalTokenAddress,
        sender,
        receiver,
        amount,
        txHex,
      })
      .inc();
  }
}

export default MetricRegister;
