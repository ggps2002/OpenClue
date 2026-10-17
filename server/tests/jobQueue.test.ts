import { describe, expect, it } from 'vitest';
import { JobCanceledError, JobQueue } from '../src/lib/jobQueue';

/** A task that waits until released (or aborted). */
function gate() {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (release = resolve));
  const started: AbortSignal[] = [];
  const task = async (signal: AbortSignal) => {
    started.push(signal);
    await Promise.race([
      opened,
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })),
    ]);
  };
  return { task, release, started };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('JobQueue', () => {
  it('runs jobs in order, at most `concurrency` at a time, and reports positions', async () => {
    const queue = new JobQueue(1);
    const a = gate();
    const b = gate();
    queue.enqueue('a', a.task);
    queue.enqueue('b', b.task);
    await tick();
    expect(a.started).toHaveLength(1);
    expect(b.started).toHaveLength(0);
    expect(queue.position('a')).toBe(0);
    expect(queue.position('b')).toBe(1);
    expect(queue.position('zzz')).toBeNull();

    a.release();
    await tick();
    expect(b.started).toHaveLength(1);
    expect(queue.position('a')).toBeNull();
    b.release();
    await queue.idle();
    expect(queue.has('b')).toBe(false);
  });

  it('runs several jobs at once when allowed', async () => {
    const queue = new JobQueue(2);
    const jobs = [gate(), gate(), gate()];
    jobs.forEach((job, i) => queue.enqueue(String(i), job.task));
    await tick();
    expect(jobs.map((j) => j.started.length)).toEqual([1, 1, 0]);
    jobs.forEach((j) => j.release());
    await queue.idle();
    expect(jobs.map((j) => j.started.length)).toEqual([1, 1, 1]);
  });

  it('removes waiting jobs and aborts running ones on cancel', async () => {
    const queue = new JobQueue(1);
    const a = gate();
    const b = gate();
    queue.enqueue('a', a.task);
    queue.enqueue('b', b.task);
    await tick();

    expect(queue.cancel('b')).toBe(true);
    expect(queue.cancel('a')).toBe(true);
    expect(a.started[0].aborted).toBe(true);
    expect(a.started[0].reason).toBeInstanceOf(JobCanceledError);
    await queue.idle();
    expect(b.started).toHaveLength(0);
    expect(queue.cancel('a')).toBe(false);
  });

  it('keeps going after a job throws and rejects duplicate ids', async () => {
    const queue = new JobQueue(1);
    let ran = false;
    queue.enqueue('bad', () => Promise.reject(new Error('boom')));
    expect(() => queue.enqueue('bad', async () => undefined)).toThrow(/already queued/);
    queue.enqueue('good', async () => {
      ran = true;
    });
    await queue.idle();
    expect(ran).toBe(true);
    expect(() => new JobQueue(0)).toThrow();
  });
});
