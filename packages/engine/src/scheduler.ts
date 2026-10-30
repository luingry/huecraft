/** Error used for superseded requests; `name === 'AbortError'`. */
export function abortError(message = 'Superseded by a newer request'): Error {
  const e = new Error(message);
  e.name = 'AbortError';
  return e;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

interface Job<P, R> {
  params: P;
  resolve: (r: R) => void;
  reject: (e: unknown) => void;
}

/**
 * Latest-wins request queue: at most one job runs; while it runs only the
 * newest request is kept pending and any older pending request is rejected
 * with an AbortError. The running job always completes normally.
 */
export class LatestWinsQueue<P, R> {
  private running = false;
  private pending: Job<P, R> | null = null;

  constructor(private readonly run: (params: P) => Promise<R>) {}

  request(params: P): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      if (this.pending) this.pending.reject(abortError());
      this.pending = { params, resolve, reject };
      this.pump();
    });
  }

  /** Reject the pending request (the running one, if any, still settles). */
  cancelPending(reason: Error = abortError()): void {
    const p = this.pending;
    this.pending = null;
    p?.reject(reason);
  }

  get busy(): boolean {
    return this.running;
  }

  private pump(): void {
    if (this.running || !this.pending) return;
    const job = this.pending;
    this.pending = null;
    this.running = true;
    let promise: Promise<R>;
    try {
      promise = this.run(job.params);
    } catch (e) {
      promise = Promise.reject(e);
    }
    promise.then(job.resolve, job.reject).finally(() => {
      this.running = false;
      this.pump();
    });
  }
}
