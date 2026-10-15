import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';

/**
 * Local-disk storage for media. Files are addressed by a relative `key` (e.g. `media/<ws>/<uuid>.mp4`);
 * nothing outside this class should build paths under the storage root.
 */
export class StorageService {
  constructor(readonly root: string = env.storageDir) {}

  /** Scratch directory for in-flight uploads; lives on the same disk so `adopt` can rename. */
  get tmpDir(): string {
    return path.join(this.root, 'tmp');
  }

  /** Builds a fresh, collision-free key under `prefix`, keeping the original file extension. */
  createKey(prefix: string, originalName: string): string {
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    return path.posix.join(...prefix.split('/').filter(Boolean), `${randomUUID()}${ext}`);
  }

  /** Moves an existing file (e.g. a multer temp upload) into storage under `key`. */
  async adopt(sourcePath: string, key: string): Promise<void> {
    const target = this.resolve(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.promises.rename(sourcePath, target);
    } catch (err) {
      // Cross-device moves can't rename; fall back to copy + delete.
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await fs.promises.copyFile(sourcePath, target);
      await fs.promises.rm(sourcePath, { force: true });
    }
  }

  async write(key: string, data: Buffer | string): Promise<void> {
    const target = this.resolve(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, data);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.promises.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  /** Deletes the file if present; missing files are not an error. */
  async remove(key: string): Promise<void> {
    await fs.promises.rm(this.resolve(key), { force: true });
  }

  /** Absolute path for a key. Throws if the key would escape the storage root. */
  resolve(key: string): string {
    const root = path.resolve(this.root);
    const target = path.resolve(root, key);
    if (!key || path.isAbsolute(key) || !target.startsWith(root + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return target;
  }
}
