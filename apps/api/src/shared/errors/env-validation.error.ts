export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}
