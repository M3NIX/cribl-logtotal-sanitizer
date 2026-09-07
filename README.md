# Cribl LogTotal Sanitizer

A [Cribl Stream Pack](https://docs.cribl.io/stream/packs/) that replaces sensitive
log values with deterministic pseudonyms using
[`@socprime/logtotal-sanitizer`](https://github.com/socprime/logtotal-sanitizer).
Repeated values receive matching tokens when the key and configuration match.

The Pack applies all default detectors to `_raw`: secrets, cookies, payment and
health data, government IDs, phone numbers, IP/MAC addresses, hosts, users/email,
locations, and paths. It sets `__logtotal_sanitized: true` when a value changes.
All other fields, including `_time`, are preserved. Unmatched or skipped events
are unchanged.

## Install

Requires Cribl Stream 4.19.2 or newer with Node.js 20 or newer.

1. Download `cc-stream-logtotal-sanitizer-<version>.crbl` from the GitHub release.
2. In your Worker Group, open **Processing > Packs > Add Pack > Import from File**.
   Select the file and enable **Allow custom functions**.
3. In the Worker Group's Secrets settings, create a **text** Secret named
   `logtotal_sanitizer_key`. Generate its value with `openssl rand -hex 32`.
4. Open the Pack's **logtotal-sanitizer** pipeline and run the bundled
   **LogTotal preview** sample in Data Preview.
5. In the Worker Group's data routes, select this Pack as the pipeline and choose
   your Destination. Use filter `true` to sanitize every routed event, placing
   this route before other matching final routes.
6. Commit and deploy the Worker Group.

The Pack bundles its Function and dependency; no filesystem installation or npm
commands are needed. Its internal route uses
`typeof _raw === 'string' && _raw.length > 0` to select events for
`logtotal-sanitizer`; a default passthrough route leaves other events unchanged.
Importing the Pack does not change the Worker Group's outer routes or Destinations.

The Pack contains no secret value. Create the named Secret before using it;
missing or invalid keys cause Function initialization to fail. Keep the key
stable and private. Workers that need matching tokens must share the same key,
Pack version, and rule configuration. Rotating the key changes the tokens.

## Configure

Open **Pipelines > logtotal-sanitizer > LogTotal Sanitizer** inside the Pack.

| Setting | Behavior |
| --- | --- |
| Sanitization Key Expression | Defaults to `C.Secret('logtotal_sanitizer_key', 'text').value`. Quote literal test keys. |
| Field | Top-level string field to sanitize; defaults to `_raw`. |
| Sanitization Rules | Ordered detectors. Omitted uses all defaults; an empty list disables built-in rules. |
| Additional Rules (JSON) | Custom rules applied after built-in rules, in array order. |
| Aggressive Matching | Broader matching with extra CPU cost and possible false positives; off by default. |

If you change **Field**, update the Pack's sanitization route filter to check
that field as well.

### Custom rules

Paste a JSON array into **Additional Rules (JSON)**. This example replaces
`CASE-123456` with a `<TICKET:...>` token:

```json
[
  {
    "id": "ticket",
    "label": "Ticket IDs",
    "description": "Internal ticket numbers",
    "mode": "pseudo",
    "token": "TICKET",
    "patterns": ["(?:CASE-\\d{6})"]
  }
]
```

<details>
<summary>Advanced rule options and validation</summary>

- Patterns are regex source strings, without `/` delimiters or flags. LogTotal
  applies global and Unicode matching.
- With no capturing group, the whole match is replaced. One capturing group
  selects the sensitive portion: `(?:employee=)(EMP-\d{4})` preserves
  `employee=`. Escape backslashes in JSON as shown above. Named groups and
  multiple capturing groups are rejected.
- IDs must be unique JavaScript-style identifiers and cannot override built-ins.
  Invalid JSON or rule definitions cause Function initialization to fail.
- `pseudo` uses the configured token prefix; `mask` uses `<R:...>`.
- `aggressivePatterns` runs only with **Aggressive Matching** enabled.
- `jsonKeys` also matches string values under the specified keys in JSON text.

</details>

## Preview

Run **LogTotal preview** with the default configuration after creating the Secret.
The sample contains 100 synthetic events covering plain text, JSON, multiline
logs, repeated identifiers, and unchanged controls. All identities and tokens
are fictional.
Repeated emails and IPs should get identical `<USER:...>` and `<IP:...>` tokens.
The first two events receive the sanitization flag; the control event stays
unchanged. `_time` and `source` stay the same in every event. Add the custom
`ticket` rule above to also sanitize the first event's ticket number.

## Development and releases

```bash
npm ci --ignore-scripts
npm test
```

Tests build and verify `dist/cc-stream-logtotal-sanitizer-<version>.crbl` and produce
its SHA-256 checksum. Use `npm run package` to build without running tests.
The build bundles the locked LogTotal CommonJS runtime and license from
`node_modules`. Dependabot checks npm dependencies and GitHub Actions weekly.

To release, run `npm version patch --no-git-tag-version` (or choose `minor` or
`major`), then run the tests and commit `package.json` and `package-lock.json`
alongside the release changes and a dated entry in **Release Notes**. Create and push a `v<version>` tag matching
`package.json`, such as `v0.1.1`. CI tests the Pack and publishes it with its
checksum. The Pack and Function versions both come from `package.json`.

You can also publish the release and its matching tag through GitHub's UI.
The workflow attaches the Pack and checksum to an existing release, preserving
its title and notes. Repeated runs replace assets with the same filenames.

## Release Notes

### Version 0.1.0 - 2026-09-07

Initial release. Includes the LogTotal sanitizer Function, a pipeline for `_raw`,
a passthrough fallback route, and 100 synthetic preview events.

## Contributing

Report bugs or propose changes through [GitHub issues](https://github.com/M3NIX/cribl-logtotal-sanitizer/issues)
or submit a pull request. For bugs, include your Cribl and Pack versions, expected
behavior, and a synthetic example. Never include secret values or real sensitive
logs. See **Development and releases** for local setup and checks.

## License

Licensed under the [MIT License](https://opensource.org/license/mit).
The bundled LogTotal dependency retains its
[Apache-2.0 license](https://www.apache.org/licenses/LICENSE-2.0).
This project is not affiliated with Cribl or SOC Prime.
