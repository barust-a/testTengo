import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Notice } from '../domain/notice.js';
import { parseBoampNotice } from './boamp.js';
import { parsePlatformNotice, type PlatformPage } from './platform.js';

export interface FixtureFailure {
  file: string;
  error: unknown;
}

export interface LoadedFixtures {
  notices: Notice[];
  /** Files that could not be parsed; one broken notice must not block the others. */
  failures: FixtureFailure[];
}

async function parseEach(files: string[], parse: (file: string) => Promise<Notice>): Promise<LoadedFixtures> {
  const outcomes = await Promise.allSettled(files.map(parse));
  const loaded: LoadedFixtures = { notices: [], failures: [] };
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') loaded.notices.push(outcome.value);
    else loaded.failures.push({ file: files[index], error: outcome.reason });
  });
  return loaded;
}

async function loadBoamp(directory: string): Promise<LoadedFixtures> {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.xml')).sort();
  return parseEach(files, async (file) => parseBoampNotice(await readFile(path.join(directory, file), 'utf8')));
}

async function loadPlatform(directory: string): Promise<LoadedFixtures> {
  const manifest = JSON.parse(await readFile(path.join(directory, 'pages.json'), 'utf8')) as {
    pages: PlatformPage[];
  };
  const pages = new Map(manifest.pages.map((page) => [page.file, page]));
  return parseEach([...pages.keys()].sort(), async (file) =>
    parsePlatformNotice(await readFile(path.join(directory, file), 'utf8'), pages.get(file)!),
  );
}

/** BOAMP notices first, then platform pages, each in file name order. */
export async function loadFixtureNotices(fixturesDir: string): Promise<LoadedFixtures> {
  const [boamp, platform] = await Promise.all([
    loadBoamp(path.join(fixturesDir, 'boamp')),
    loadPlatform(path.join(fixturesDir, 'platform')),
  ]);
  return {
    notices: [...boamp.notices, ...platform.notices],
    failures: [...boamp.failures, ...platform.failures],
  };
}
