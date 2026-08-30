/**
 * Base for every failure the domain raises. Domain errors describe a rule that was violated, not
 * an operation that went wrong, so they carry no cause and no transport detail.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An amount could not be represented on the destination chain without losing or inventing value. */
export class AmountConversionError extends DomainError {}

/** A transaction does not have the shape the bridge requires. */
export class InvalidTransactionError extends DomainError {}
