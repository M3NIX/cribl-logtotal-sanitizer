'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const modulePath = require.resolve('../index');

function loadFunction() {
  delete require.cache[modulePath];
  return require(modulePath);
}

test('rejects an empty sanitization key', () => {
  const fn = loadFunction();
  assert.throws(
    () => fn.init({ conf: { key: '' } }),
    /must resolve to a non-empty string/
  );
});

test('sanitizes deterministically and preserves other fields', () => {
  const fn = loadFunction();
  fn.init({ conf: { key: 'test-key', rules: ['ips', 'users'] } });

  const first = fn.process({
    _raw: 'alice@example.com connected from 10.20.30.40',
    source: 'preview'
  });
  const second = fn.process({
    _raw: 'alice@example.com connected from 10.20.30.40'
  });

  assert.match(first._raw, /<USER:[a-f0-9]+>/);
  assert.match(first._raw, /<IP:[a-f0-9]+>/);
  assert.equal(first._raw, second._raw);
  assert.equal(first.source, 'preview');
  assert.equal(first.__logtotal_sanitized, true);
  assert.equal(second.__logtotal_sanitized, true);
});

test('an explicitly empty rule list disables built-in rules', () => {
  const fn = loadFunction();
  fn.init({ conf: { key: 'test-key', rules: [] } });
  const event = fn.process({ _raw: '10.20.30.40' });
  assert.equal(event._raw, '10.20.30.40');
  assert.equal(event.__logtotal_sanitized, undefined);
});

test('ignores missing, empty, and non-string field values', () => {
  const fn = loadFunction();
  fn.init({ conf: { key: 'test-key' } });

  for (const event of [{}, { _raw: '' }, { _raw: null }, { _raw: 42 }]) {
    const snapshot = structuredClone(event);
    assert.strictEqual(fn.process(event), event);
    assert.deepEqual(event, snapshot);
  }
});

test('does not mark an unmatched string event', () => {
  const fn = loadFunction();
  fn.init({ conf: { key: 'test-key', rules: ['ips'] } });
  const event = fn.process({ _raw: 'control event without sensitive data' });

  assert.equal(event._raw, 'control event without sensitive data');
  assert.equal(event.__logtotal_sanitized, undefined);
});

test('can sanitize a configured top-level field', () => {
  const fn = loadFunction();
  fn.init({ conf: { key: 'test-key', field: 'message', rules: ['ips'] } });
  const event = fn.process({ _raw: '10.20.30.40', message: '10.20.30.40' });

  assert.equal(event._raw, '10.20.30.40');
  assert.match(event.message, /<IP:[a-f0-9]+>/);
  assert.equal(event.__logtotal_sanitized, true);
});

test('preserves timestamps and other fields, apart from the intended sanitization flag', () => {
  for (const field of ['_raw', 'message']) {
    const fn = loadFunction();
    fn.init({ conf: { key: 'test-key', field, rules: ['ips'] } });
    const event = {
      _raw: 'original raw value',
      message: 'original message',
      _time: 1788771600.125,
      host: '10.20.30.40',
      source: 'preview',
      sourcetype: 'test',
      __logtotal_sanitized: false,
      nested: { values: ['10.20.30.40', null, 42] },
      [field]: '10.20.30.40'
    };
    const before = structuredClone(event);
    const nested = event.nested;
    assert.strictEqual(fn.process(event), event);
    assert.match(event[field], /^<IP:[a-f0-9]+>$/);
    assert.deepEqual(event, { ...before, [field]: event[field], __logtotal_sanitized: true });
    assert.strictEqual(event.nested, nested);
  }
});

test('applies custom rules using LogTotal rule definitions', () => {
  const fn = loadFunction();
  fn.init({ conf: {
    key: 'test-key',
    rules: [],
    additionalRules: JSON.stringify([{
      id: 'ticket',
      label: 'Ticket IDs',
      description: 'Internal ticket numbers',
      mode: 'pseudo',
      token: 'TICKET',
      patterns: ['(?:CASE-\\d{6})']
    }])
  } });

  const event = fn.process({ _raw: 'opened CASE-123456' });
  assert.match(event._raw, /^opened <TICKET:[a-f0-9]+>$/);
  assert.equal(event.__logtotal_sanitized, true);
});

test('custom capturing groups preserve context around the sensitive value', () => {
  const fn = loadFunction();
  fn.init({ conf: {
    key: 'test-key',
    rules: [],
    additionalRules: JSON.stringify([{
      id: 'employee',
      label: 'Employee IDs',
      description: 'Employee identifiers after employee=',
      mode: 'mask',
      patterns: ['(?:employee=)(EMP-\\d{4})']
    }])
  } });

  assert.match(fn.process({ _raw: 'employee=EMP-1234' })._raw, /^employee=<R:[a-f0-9]+>$/);
});

test('custom aggressive patterns only run in aggressive mode', () => {
  const additionalRules = JSON.stringify([{
    id: 'asset',
    label: 'Asset IDs',
    description: 'Broad asset identifiers',
    mode: 'pseudo',
    token: 'ASSET',
    patterns: ['(?:ASSET-\\d{6})'],
    aggressivePatterns: ['(?:A-\\d{3})']
  }]);

  let fn = loadFunction();
  fn.init({ conf: { key: 'test-key', rules: [], additionalRules } });
  assert.equal(fn.process({ _raw: 'A-123' })._raw, 'A-123');

  fn = loadFunction();
  fn.init({ conf: { key: 'test-key', rules: [], additionalRules, aggressive: true } });
  assert.match(fn.process({ _raw: 'A-123' })._raw, /^<ASSET:[a-f0-9]+>$/);
});

test('rejects invalid, duplicate, and built-in custom rule IDs', () => {
  const base = {
    label: 'Test rule',
    description: 'Test description',
    mode: 'pseudo',
    patterns: ['(?:TEST-\\d+)']
  };

  assert.throws(
    () => loadFunction().init({ conf: {
      key: 'test',
      additionalRules: JSON.stringify([{ ...base, id: 'ips' }])
    } }),
    /conflicts with a built-in rule/
  );
  assert.throws(
    () => loadFunction().init({ conf: {
      key: 'test',
      additionalRules: JSON.stringify([
        { ...base, id: 'ticket' },
        { ...base, id: 'ticket' }
      ])
    } }),
    /Duplicate custom rule id/
  );
  assert.throws(
    () => loadFunction().init({ conf: {
      key: 'test',
      additionalRules: JSON.stringify([{ ...base, id: 'bad-id' }])
    } }),
    /valid ASCII identifier/
  );
  assert.throws(
    () => loadFunction().init({ conf: {
      key: 'test',
      additionalRules: JSON.stringify([{ ...base, id: 'groups', patterns: ['(one)(two)'] }])
    } }),
    /at most one capturing group/
  );
});

test('rejects malformed additional-rules JSON and non-array JSON', () => {
  assert.throws(
    () => loadFunction().init({ conf: { key: 'test', additionalRules: '[{' } }),
    /must be valid JSON/
  );
  assert.throws(
    () => loadFunction().init({ conf: { key: 'test', additionalRules: '{}' } }),
    /must be a JSON array/
  );
});

test('rejects non-object custom rules instead of silently skipping them', () => {
  for (const rule of [null, false, 42, 'ticket']) {
    assert.throws(
      () => loadFunction().init({ conf: {
        key: 'test', additionalRules: JSON.stringify([rule])
      } }),
      /A rule must be an object/
    );
  }
});

test('failed reinitialization preserves the previous field and sanitizer together', () => {
  const fn = loadFunction();
  fn.init({ conf: { key: 'test-key', rules: ['ips'] } });
  assert.throws(
    () => fn.init({ conf: { key: 'new-key', field: 'message', rules: ['invalid'] } }),
    /Unknown rule/
  );

  const event = fn.process({ _raw: '10.20.30.40', message: '10.20.30.40' });
  assert.match(event._raw, /<IP:[a-f0-9]+>/);
  assert.equal(event.message, '10.20.30.40');
});

test('default rules sanitize JSON keys and multiline text', () => {
  const fn = loadFunction();
  fn.init({ conf: { key: 'test-key' } });
  const event = fn.process({ _raw: '{"email":"alice@example.com"}\n10.20.30.40\n' });
  const lines = event._raw.split('\n');
  assert.match(JSON.parse(lines[0]).email, /^<USER:[a-f0-9]+>$/);
  assert.match(lines[1], /^<IP:[a-f0-9]+>$/);
  assert.equal(lines[2], '');
});
