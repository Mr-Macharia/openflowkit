// @vitest-environment node
// GitHub reads action.yml and the workflows only when a run needs them: a YAML slip (an unquoted ": " in a
// description) surfaced first on a launch PR. Parse each one here, strictly, so it fails before it ships.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const files = ['action/action.yml', ...readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name)).map((name) => `.github/workflows/${name}`)];

describe('action and workflow YAML', () => {
  it.each(files)('%s parses', (file) => {
    const doc = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true });
    expect(doc.errors.map((error) => error.message)).toEqual([]);
    expect(typeof doc.toJS()).toBe('object');
  });

  it('the action declares its inputs and a composite run', () => {
    const action = parseDocument(readFileSync('action/action.yml', 'utf8')).toJS();
    expect(Object.keys(action.inputs)).toEqual(expect.arrayContaining(['github-token', 'cli', 'refresh-svg', 'paths']));
    expect(action.runs.using).toBe('composite');
  });
});
