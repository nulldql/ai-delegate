export class ProviderError extends Error {
  readonly provider: string;
  readonly retryable: boolean;

  constructor(message: string, provider: string, retryable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.retryable = retryable;
  }
}
