import { AmountConversionError } from './errors';

/** Hathor amounts always carry exactly two decimal places. */
export const HATHOR_DECIMALS = 2;

function scaleFactor(tokenDecimals: number): { factor: bigint; hathorHasFewerDecimals: boolean } {
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 77) {
    throw new AmountConversionError(`Token decimals must be an integer in [0, 77], got ${tokenDecimals}.`);
  }
  const difference = tokenDecimals - HATHOR_DECIMALS;
  return {
    factor: 10n ** BigInt(Math.abs(difference)),
    hathorHasFewerDecimals: difference >= 0,
  };
}

/**
 * Converts an amount from an EVM token's precision down to Hathor's two decimals.
 *
 * Replaces `convertToHathorDecimals`, which did this by slicing digits off the decimal string.
 * That worked, but only for non-negative values, and it leaned on `parseInt` at the end - so an
 * amount above 2^53 came back rounded, silently. The arithmetic is the same operation, done on
 * bigints.
 *
 * Truncation is deliberate and matches the previous behaviour: anything finer than Hathor can
 * represent is dropped rather than rounded, so the bridge never credits more than was locked.
 *
 * The two implementations were run against each other over a grid of decimals and amounts. They
 * agree everywhere except beyond 2^53, where the old `parseInt` lost precision - twice by rounding
 * UP, which would have credited more than was locked. Those amounts are far past any realistic
 * token supply, so this was latent rather than live, but the arithmetic is now exact regardless.
 *
 * @throws AmountConversionError if the amount is negative, or if it truncates to zero - both
 *         would put a meaningless transfer on chain.
 */
export function toHathorAmount(evmAmount: bigint, tokenDecimals: number): bigint {
  if (evmAmount < 0n) {
    throw new AmountConversionError(`Cannot convert a negative amount (${evmAmount}) to a Hathor amount.`);
  }

  const { factor, hathorHasFewerDecimals } = scaleFactor(tokenDecimals);
  const converted = hathorHasFewerDecimals ? evmAmount / factor : evmAmount * factor;

  if (converted === 0n) {
    throw new AmountConversionError(
      `Amount ${evmAmount} of a ${tokenDecimals}-decimal token is below the smallest amount Hathor ` +
        `can represent, so it would convert to zero.`,
    );
  }

  return converted;
}

/**
 * Converts a Hathor amount up to an EVM token's precision.
 *
 * Replaces `convertToEvmDecimals`, which hardcoded a factor of 10^16 - i.e. it assumed every token
 * has 18 decimals - and, on any error, logged to the console and returned `undefined`, letting a
 * missing amount travel onward as if it were a value. Both are gone: the scale comes from the
 * token and failures throw.
 *
 * This direction is always exact; Hathor's two decimals fit in any token with at least two.
 */
export function toEvmAmount(hathorAmount: bigint, tokenDecimals: number): bigint {
  if (hathorAmount < 0n) {
    throw new AmountConversionError(`Cannot convert a negative amount (${hathorAmount}) to an EVM amount.`);
  }

  const { factor, hathorHasFewerDecimals } = scaleFactor(tokenDecimals);
  return hathorHasFewerDecimals ? hathorAmount * factor : hathorAmount / factor;
}
