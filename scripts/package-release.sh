#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
version="$(node -p "require('./package.json').version")"
if [[ "${GITHUB_REF_TYPE:-}" == tag && "${GITHUB_REF_NAME#v}" != "$version" ]]; then
  printf 'Release tag must match package.json version %s\n' "$version" >&2
  exit 1
fi
archive_name="cc-stream-logtotal-sanitizer-${version}.crbl"
stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT

package_dir="$project_dir/node_modules/@socprime/logtotal-sanitizer"
test -f "$package_dir/index.cjs"
function_dir="$stage_dir/default/functions/logtotal_sanitize"
runtime_dir="$function_dir/node_modules/@socprime/logtotal-sanitizer"
mkdir -p "$project_dir/dist" "$runtime_dir"
cp -R "$project_dir/pack/." "$stage_dir/"
node - "$stage_dir" <<'NODE'
const fs = require('node:fs');
const { name, version, description, displayName, author, tags, minLogStreamVersion, license } = require('./package.json');
const stage = process.argv[2];
fs.writeFileSync(`${stage}/package.json`, JSON.stringify({ name, version, description, displayName, author, tags, minLogStreamVersion, license }, null, 2) + '\n');
fs.writeFileSync(`${stage}/default/functions/logtotal_sanitize/package.json`, JSON.stringify({ name: 'logtotal_sanitize', version, private: true }, null, 2) + '\n');
const events = fs.readFileSync('sample.ndjson', 'utf8').trim().split('\n').map(JSON.parse);
const sample = JSON.stringify(events);
fs.mkdirSync(`${stage}/data/samples`, { recursive: true });
fs.writeFileSync(`${stage}/data/samples/logtotal_preview.json`, sample);
fs.writeFileSync(`${stage}/default/samples.yml`, JSON.stringify({ logtotal_preview: { sampleName: 'LogTotal preview', size: Buffer.byteLength(sample), numEvents: events.length } }, null, 2) + '\n');
NODE

cp "$project_dir/index.js" "$project_dir/conf.schema.json" "$project_dir/conf.ui-schema.json" "$function_dir/"
cp "$project_dir/README.md" "$stage_dir/"
cp "$project_dir/LICENSE" "$function_dir/"
cp "$package_dir/"*.cjs "$package_dir/package.json" "$package_dir/LICENSE" "$runtime_dir/"

tar -C "$stage_dir" -czf "$project_dir/dist/$archive_name" .
(
  cd "$project_dir/dist"
  sha256sum "$archive_name" > "$archive_name.sha256"
)

printf 'Created dist/%s\n' "$archive_name"
