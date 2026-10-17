/** A unit of background work; it should stop early (and reject) when `signal` aborts. */
export type JobTask = (signal: AbortSignal) => Promise<void>;

interface QueuedJob {
  id: string;
  task: JobTask;
  controller: AbortController;
}

/**
 * Runs long tasks (renders) in this process, at most `concurrency` at a time, in arrival order.
 * State is in memory only: callers persist their own status and treat unfinished work as lost on restart.
 */
export class JobQueue {
  private readonly waiting: QueuedJob[] = [];
  private readonly running = new Map<string, QueuedJob>();
  private idleWaiters: (() => void)[] = [];

  constructor(readonly concurrency = 1) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('JobQueue concurrency must be a positive integer');
  }

  /** Queues a task. A task's errors are its own to record; the queue only logs ones that escape. */
  enqueue(id: string, task: JobTask): void {
    if (this.has(id)) throw new Error(`Job ${id} is already queued`);
    this.waiting.push({ id, task, controller: new AbortController() });
    this.pump();
  }

  has(id: string): boolean {
    return this.running.has(id) || this.waiting.some((j) => j.id === id);
  }

  /** 0 while running, 1+ for the place in line (1 = next), null when unknown or finished. */
  position(id: string): number | null {
    if (this.running.has(id)) return 0;
    const index = this.waiting.findIndex((j) => j.id === id);
    return index === -1 ? null : index + 1;
  }

  /** Removes a waiting job or aborts a running one. Returns false when the job isn't in the queue. */
  cancel(id: string): boolean {
    const index = this.waiting.findIndex((j) => j.id === id);
    if (index !== -1) {
      this.waiting.splice(index, 1);
      this.notifyIfIdle();
      return true;
    }
    const job = this.running.get(id);
    if (!job) return false;
    job.controller.abort(new JobCanceledError());
    return true;
  }

  /** Resolves once nothing is waiting or running (used by tests and shutdown). */
  idle(): Promise<void> {
    if (this.isIdle) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private get isIdle(): boolean {
    return this.waiting.length === 0 && this.running.size === 0;
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift() as QueuedJob;
      this.running.set(job.id, job);
      // Start on a later tick so `enqueue` returns before the task does any work.
      void Promise.resolve()
        .then(() => job.task(job.controller.signal))
        .catch((err: unknown) => {
          if (!(err instanceof JobCanceledError)) console.error(`[jobs] job ${job.id} failed`, err);
        })
        .finally(() => {
          this.running.delete(job.id);
          this.pump();
          this.notifyIfIdle();
        });
    }
  }

  private notifyIfIdle(): void {
    if (!this.isIdle) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

/** The abort reason of a canceled job. */
export class JobCanceledError extends Error {
  constructor() {
    super('The job was canceled');
    this.name = 'JobCanceledError';
  }
}
