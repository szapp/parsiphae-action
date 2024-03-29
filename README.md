# Parsiphae Action

[![CI](https://github.com/szapp/parsiphae-action/actions/workflows/ci.yml/badge.svg)](https://github.com/szapp/parsiphae-action/actions/workflows/ci.yml)
[![Coverage](badges/coverage.svg)](https://github.com/szapp/parsiphae-action/actions/workflows/ci.yml)
[![Marketplace](https://img.shields.io/github/v/release/szapp/parsiphae-action?logo=githubactions&logoColor=white&label=marketplace)](https://github.com/marketplace/actions/daedalus-parsiphae)

GitHub action for [Parsiphae](https://github.com/Lehona/Parsiphae), a WIP compiler for the Daedalus scripting language, written by and maintained by [@Lehona](https://github.com/Lehona).

## Checks

Checks are added to commits and performed on pull requests.

### Checks page

![actions-checks](.github/screenshots/actions-checks.png)

### Commit file and line annotations

![commit-checks](.github/screenshots/commit-checks.png)

### Pull request checks

![pr-checks](.github/screenshots/pr-checks.png)

## Usage

Create a new GitHub Actions workflow in your project, e.g. at `.github/workflows/scripts.yml`.
The content of the file should be in the following format:

```yaml
name: scripts

# Run workflow on push with changes of src or d files
on:
  push:
    paths:
      - '**.src'
      - '**.d'

# These permissions are necessary for creating the check runs
permissions:
  checks: write
  contents: read

# The checkout action needs to be run first
jobs:
  parsiphae:
    name: Run Parsiphae on scripts
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check scripts
        uses: szapp/parsiphae-action@v1
        with:
          file: _work/Data/Scripts/Content/Gothic.src
```

## Configuration

- `file`:
  File path within the repository of the D file or the SRC file to parse, e.g. `_work\Data\Scripts\Content\Gothic.src`  
  _Required_

- `token`:
  The `GITHUB_TOKEN` to [authenticate on behalf of GitHub Actions](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow).  
  Defaults to the GitHub token, i.e. checks are created by the GitHub Actions bot.

- `check_name`:
  Specify a different name for the check run.
  Useful to differentiate checks if there are multiple instances of this action in one workflow.  
  Defaults to 'Parsiphae'

- `cache`:
  Cache the Parsiphae built in between workflow runs.
  This greatly increases speed of the check as Parsiphae is not cloned and re-built every time.
  The cached executable is specific to the workflow runner OS and the Parsiphae version.  
  Defaults to true
