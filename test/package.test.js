'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');

test('builds a self-contained Cribl Pack with a working sanitizer and sample', () => {
  execFileSync('bash', ['scripts/package-release.sh'], { cwd: root });
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'logtotal-pack-test-'));
  try {
    execFileSync('tar', ['-xzf', `dist/${pkg.name}-${pkg.version}.crbl`, '-C', stage], { cwd: root });
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    assert.equal(manifest.name, pkg.name);
    assert.equal(manifest.version, pkg.version);
    const route = fs.readFileSync(path.join(stage, 'default/pipelines/route.yml'), 'utf8');
    const filters = [...route.matchAll(/filter: "([^"]+)"/g)].map(match => match[1]);
    const accepts = new Function('_raw', `return (${filters[0]});`);
    assert.equal(accepts('user@example.com'), true);
    for (const value of [undefined, null, '', 0, false, {}, []]) {
      assert.equal(accepts(value), false);
    }
    assert.equal(filters[1], 'true');
    assert.match(route, /pipeline: passthru/);
    assert.equal(fs.readFileSync(path.join(stage, 'default/pipelines/passthru/conf.yml'), 'utf8').trim(), 'functions: []');
    assert.match(route, /pipeline: logtotal-sanitizer/);
    const pipeline = fs.readFileSync(path.join(stage, 'default/pipelines/logtotal-sanitizer/conf.yml'), 'utf8');
    assert.match(pipeline, /id: logtotal_sanitize/);
    assert.match(pipeline, /C\.Secret\('logtotal_sanitizer_key', 'text'\)\.value/);
    assert.match(pipeline, /field: _raw/);

    const fn = require(path.join(stage, 'default/functions/logtotal_sanitize'));
    assert.equal(fn.version, manifest.version);
    fn.init({ conf: { key: 'pack-test-key' } });
    const sample = JSON.parse(fs.readFileSync(path.join(stage, 'data/samples/logtotal_preview.json'), 'utf8'));
    const before = structuredClone(sample);
    const first = fn.process(sample[0]);
    const second = fn.process(sample[1]);
    assert.match(first._raw, /<USER:[a-f0-9]+>/);
    assert.equal(first._raw.match(/<IP:[a-f0-9]+>/)[0], second._raw.match(/<IP:[a-f0-9]+>/)[0]);
    assert.equal(fn.process(sample[2]).__logtotal_sanitized, undefined);
    for (const [i, event] of sample.entries()) {
      assert.equal(typeof event._time, 'number');
      assert.deepEqual(event, {
        ...before[i],
        _raw: event._raw,
        ...(event._raw !== before[i]._raw ? { __logtotal_sanitized: true } : {})
      });
    }
    assert.ok(fs.existsSync(path.join(stage, 'default/functions/logtotal_sanitize/LICENSE')));
    const runtime = path.join(stage, 'default/functions/logtotal_sanitize/node_modules/@socprime/logtotal-sanitizer');
    const dependency = JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8'));
    assert.equal(dependency.version, pkg.dependencies['@socprime/logtotal-sanitizer']);
    assert.ok(fs.existsSync(path.join(runtime, 'LICENSE')));
    assert.ok(fs.readdirSync(runtime).every(file => file.endsWith('.cjs') || ['package.json', 'LICENSE'].includes(file)));
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

test('rejects release tags that disagree with the Pack version', () => {
  assert.throws(() => execFileSync('bash', ['scripts/package-release.sh'], {
    cwd: root,
    env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v999.0.0' },
    stdio: 'pipe'
  }), /Release tag must match/);
});
