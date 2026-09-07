'use strict';

exports.name = 'LogTotal Sanitizer';
exports.version = require('./package.json').version;
exports.group = 'Privacy';
exports.sync = true;

const {
  builtinRuleIds,
  createSanitizer,
  defineRule
} = require('@socprime/logtotal-sanitizer');

const DEFAULT_RULES = require('./conf.schema.json').properties.rules.default;

let sanitizer;
let field = '_raw';

function createCustomRules(additionalRules) {
  if (additionalRules == null || additionalRules === '') {
    return [];
  }
  if (typeof additionalRules !== 'string') {
    throw new Error('Additional Rules must be a JSON string containing an array');
  }
  if (additionalRules.trim() === '') return [];

  let configuredRules;
  try {
    configuredRules = JSON.parse(additionalRules);
  } catch (error) {
    throw new Error(`Additional Rules must be valid JSON: ${error.message}`);
  }

  if (!Array.isArray(configuredRules)) {
    throw new Error('Additional Rules must be a JSON array');
  }

  const reservedIds = new Set(builtinRuleIds);
  const customIds = new Set();

  return configuredRules.map((rule) => {
    defineRule(rule);
    if (reservedIds.has(rule.id)) {
      throw new Error(`Custom rule id "${rule.id}" conflicts with a built-in rule`);
    }
    if (customIds.has(rule.id)) {
      throw new Error(`Duplicate custom rule id "${rule.id}"`);
    }
    customIds.add(rule.id);

    return rule;
  });
}

exports.init = (opts = {}) => {
  const conf = opts.conf || {};

  if (typeof conf.key !== 'string' || conf.key.length === 0) {
    throw new Error('Sanitization key expression must resolve to a non-empty string');
  }

  const rules = Array.isArray(conf.rules) ? conf.rules : DEFAULT_RULES;
  const customRules = createCustomRules(conf.additionalRules);

  sanitizer = createSanitizer({
    key: conf.key,
    keyEncoding: 'utf8',
    rules: [...rules, ...customRules],
    aggressive: conf.aggressive === true,
    report: { previewBytes: 0, replacements: false }
  });
  field = typeof conf.field === 'string' && conf.field.length > 0
    ? conf.field
    : '_raw';
};

exports.process = (event) => {
  if (!sanitizer || event == null || typeof event !== 'object') {
    return event;
  }

  const value = event[field];
  if (typeof value !== 'string' || value.length === 0) {
    return event;
  }

  const output = sanitizer.sanitizeText(value).output;
  event[field] = output;

  if (output !== value) {
    event.__logtotal_sanitized = true;
  }

  return event;
};
