# Security Policy

## Reporting a vulnerability

Report privately — do not open a public issue, discussion, or pull request for
a suspected vulnerability.

Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/rainbowindex/rainbowindex/security/advisories/new).
It creates a draft advisory only the maintainer can see.

Helpful things to include:

- What an attacker gains, and what they need in order to get it.
- The smallest reproduction you can manage — CSS entry, class string, source
  file, or CLI invocation.
- Affected version (`rainbowindex --version`), Node version, and how Rainbow
  Index is invoked (PostCSS, Vite plugin, CLI, or `compileProject`).

You should get an acknowledgement within 7 days. If a report is confirmed, the
fix ships in a patch release and the advisory is published with credit, unless
you would rather stay anonymous.

Please give a reasonable window to ship a fix before disclosing publicly.

## Supported versions

Until 1.0, only the latest minor receives fixes. There are no backports to
earlier minors — upgrade to the latest release.

| Version | Supported |
| --- | --- |
| 0.6.x | Yes |
| < 0.6 | No |

## Scope

Rainbow Index is a build-time tool: it reads CSS and source files you already
control and writes a stylesheet. Reports that matter most:

- Anything that escapes the build — arbitrary command or code execution from
  CSS input, a class name, or a scanned source file.
- Path traversal or writes outside the intended output location, in the CLI,
  the Vite plugin, or the PostCSS plugin.
- CSS injection: input that produces selectors or declarations outside the rule
  it should have generated, in a way that could affect a third party's page.
- Anything that causes the compiler to read from or send data to the network
  when it should not — the font providers are the only intended network path,
  and `RI_OFFLINE=1` must fully disable it.
- Supply-chain issues in what the package ships or depends on.

Out of scope: denial of service from deliberately pathological input you author
yourself (the compiler runs on your own machine, on your own files), and
warnings you disagree with — those are bugs, so file an issue.
