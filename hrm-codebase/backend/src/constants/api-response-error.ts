class APIResponseError extends Error {
  readonly statusCode: number;
  readonly type: string;
  readonly isAPIResponseError = true;

  constructor(message: string, type: string, statusCode: number) {
    super(message);
    this.name = "APIResponseError";
    this.statusCode = statusCode;
    this.type = type;
  }
}

export default APIResponseError;
