import type { AuthorityKind, HathorWalletPort } from '../ports/HathorWalletPort';
import type { LoggerPort } from '../ports/LoggerPort';

/**
 * Whether the mint or melt about to be proposed should also grow the multisig's pool of that
 * authority by one.
 *
 * A proposal locks the authority it spends until it is pushed or the input lock expires, and the
 * wallet only picks authorities that are not locked - so with one authority per token, every mint
 * (or melt) of that token queues behind the one in flight. Holding `target` of them lets that many
 * run at once. The pool is counted as a whole, locked ones included, so it settles at `target`
 * instead of growing whenever two proposals overlap.
 *
 * @param target HATHOR_AUTHORITY_POOL_TARGET; 0 means off, and then the wallet is not even asked.
 */
export async function shouldGrowAuthorityPool(
  wallet: HathorWalletPort,
  logger: LoggerPort,
  token: string,
  kind: AuthorityKind,
  target: number,
): Promise<boolean> {
  if (target <= 0) {
    return false;
  }
  const held = await wallet.countAuthorities(token, kind);
  if (held >= target) {
    return false;
  }
  logger.info(`The multisig holds ${held} of ${target} ${kind} authorities for ${token}; this ${kind} adds one.`);
  return true;
}
