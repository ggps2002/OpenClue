import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageService } from '../src/lib/storage';

describe('StorageService', () => {
  let root: string;
  let storage: StorageService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-storage-'));
    storage = new StorageService(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('creates unique keys under a prefix that keep a sanitised extension', () => {
    const a = storage.createKey('media/ws1', 'Demo Video.MP4');
    const b = storage.createKey('media/ws1', 'Demo Video.MP4');
    expect(a).toMatch(/^media\/ws1\/[0-9a-f-]{36}\.mp4$/);
    expect(a).not.toBe(b);
    expect(storage.createKey('x', 'noext')).toMatch(/^x\/[0-9a-f-]{36}$/);
  });

  it('writes, adopts, checks and removes files', async () => {
    await storage.write('a/b.txt', 'hello');
    expect(fs.readFileSync(path.join(root, 'a/b.txt'), 'utf8')).toBe('hello');

    const temp = path.join(root, 'incoming.bin');
    fs.writeFileSync(temp, 'data');
    await storage.adopt(temp, 'media/c.bin');
    expect(fs.existsSync(temp)).toBe(false);
    expect(await storage.exists('media/c.bin')).toBe(true);

    await storage.remove('media/c.bin');
    expect(await storage.exists('media/c.bin')).toBe(false);
    await expect(storage.remove('media/c.bin')).resolves.toBeUndefined();
  });

  it('refuses keys that escape the storage root', () => {
    expect(() => storage.resolve('../secret')).toThrow(/Invalid storage key/);
    expect(() => storage.resolve('/etc/passwd')).toThrow(/Invalid storage key/);
    expect(() => storage.resolve('')).toThrow(/Invalid storage key/);
    expect(storage.resolve('media/x.mp4')).toBe(path.join(root, 'media', 'x.mp4'));
  });
});
