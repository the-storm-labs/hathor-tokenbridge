import { data } from './HathorTx';

export type eventType =
  | 'node:state-change'
  | 'node:wallet-update'
  | 'wallet:state-change'
  | 'wallet:load-partial-update'
  | 'wallet:new-tx'
  | 'wallet:update-tx';

export type hathorEvent = {
  type: eventType;
  walletId: string;
  data: number | data;
  stateName: string;
};
