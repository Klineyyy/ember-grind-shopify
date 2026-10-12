/** An expected, user-facing failure (validation, not found, conflict) with an HTTP status. */
export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
