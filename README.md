# Zof gate

`@zof-ai/gate` lets any CI/CD pipeline block a deploy on the [Zof](https://zof.ai) Control Plane's
decision: one step and one secret ask Zof whether this commit may go to this environment, and the
job passes or fails on the answer.

> **Status: pre-release, not yet usable.** The client, GitHub Action and container image are being
> built. Nothing is published to npm or any registry yet.

## What's here

- A small, dependency-free TypeScript client (`zof-gate`) speaking the Control Plane's `gate.v1`
  contract.
- Later: the GitHub Action (`uses: zof-ai/gate@v1`), a container image for other CIs, and a GitLab
  CI Catalog component.

## Exit codes

| Code | Meaning                                                           |
| ---- | ----------------------------------------------------------------- |
| 0    | Pass: a stored Zof decision, a baseline or a recorded break-glass |
| 1    | Blocked                                                           |
| 2    | Usage or configuration error                                      |
| 3    | Zof unavailable (never a pass)                                    |
| 4    | Token problem                                                     |

There is no fail-open mode: anything other than a valid pass fails the job.

## Docs

See the Zof docs at <https://zof.ai/docs>.

## Development

Node 22 or 24.

```sh
npm ci
npm run check   # lint, typecheck, tests
```

The `gate.v1` contract (OpenAPI, JSON schemas and the Control Plane's fixtures) is copied byte for
byte into `fixtures/gate.v1/`, with its source commit in `SOURCE.json`. Refresh it from a
`control_plane` checkout with `npm run contract:sync -- <path> [ref]`; the contract tests fail if
the copy is edited or drifts from the schema version this client speaks.

## License

Apache-2.0. See [LICENSE](LICENSE).
