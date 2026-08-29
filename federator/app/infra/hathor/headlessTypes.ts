/**
 * The wire shapes the headless wallet returns. Kept apart from the domain deliberately: these are
 * somebody else's JSON, with snake_case fields and values as JSON numbers, and they must not leak
 * past the adapter that translates them.
 */

export interface HeadlessResponse {
  success?: boolean;
  message?: string;
  error?: string;
  errorCode?: string;
}

export interface HeadlessStatusResponse extends HeadlessResponse {
  statusCode?: number;
  statusMessage?: string;
}

export interface HeadlessAddressResponse extends HeadlessResponse {
  address?: string;
}

export interface HeadlessAddressIndexResponse extends HeadlessResponse {
  index?: number;
}

export interface HeadlessConfirmationResponse extends HeadlessResponse {
  confirmationNumber?: number;
}

export interface HeadlessSignaturesResponse extends HeadlessResponse {
  signatures?: string;
}

export interface HeadlessProposalResponse extends HeadlessResponse {
  txHex?: string;
}

export interface HeadlessPushResponse extends HeadlessResponse {
  hash?: string;
}

export interface HeadlessDecodedField {
  type?: string;
  address?: string;
  timelock?: number | null;
}

export interface HeadlessTxIo {
  value?: number | string;
  /** The headless decode endpoint emits both spellings; history emits only the snake_case one. */
  token_data?: number;
  tokenData?: number;
  script?: string;
  token?: string;
  decoded?: HeadlessDecodedField;
  spent_by?: string | null;
  mine?: boolean;
  tx_id?: string;
  txId?: string;
  index?: number;
}

export interface HeadlessTx {
  tx_id?: string;
  txId?: string;
  version?: number;
  timestamp?: number;
  is_voided?: boolean;
  inputs?: HeadlessTxIo[];
  outputs?: HeadlessTxIo[];
}

export interface HeadlessDecodeResponse extends HeadlessResponse {
  tx?: HeadlessTx;
}
