module.exports = async (github, context, core, checkName) => {
  const fs = require('fs');

  // Patterns
  const regexFile = new RegExp(/(?<=in file \").+(?=\")/);
  const regexLine = new RegExp(/(?<=in line )[0-9]+/);
  const regexMsg = new RegExp(/(?<=: ).+/);
  const regexPreSlash = new RegExp(/^[\\|\/]+/);

  // Extended inputs
  const { PARSIPHAE_FILEPATH: srcfile, PARSIPHAE_VERSION: parVersion, GITHUB_WORKSPACE: workspace } = process.env

  // Parsiphae report
  const stdout = fs.readFileSync('.parsiphae-action.out', 'ascii');
  const stderr = fs.readFileSync('.parsiphae-action.err', 'ascii');
  const lines = stderr.split(/\r?\n/);

  // Iterate over reported errors
  const annotations = [];
  lines.forEach((line) => {
    if (!line.length)
      return;
    const linenum = +(line.match(regexLine) || ['0'])[0];
    const message = (line.match(regexMsg) || ['invalid'])[0];
    const path = (line.match(regexFile) || ['invalid'])[0];
    const filename = core.toPosixPath(path.replace(/\\+/g, '\\').replace(workspace, '').replace(regexPreSlash, ''));
    annotations.push({
      path: filename,
      start_line: linenum,
      end_line: linenum,
      annotation_level: 'failure',
      message: message
    });
  });

  // Construct detailed information
  const pos = stdout.search(/Parsed |parsing took/);
  let tree = stdout.substring(0, pos-1).trim();
  if (tree) {
    tree = `<details><summary>Summary</summary><pre>${tree}</pre></details>`;
  }
  const info = stdout.substring(pos);
  const link = `https://github.com/Lehona/Parsiphae/tree/${parVersion}`;
  const details = `
Parsiphae parsed \`${srcfile}\`.

${tree}

${info}

For more details on Parsiphae, see [Lehona/Parsiphae@${parVersion}](${link}).
`;

  // Create Gitub check run
  const numErr = annotations.length;
  const { data: { details_url } } = await github.rest.checks.create({
    ...context.repo,
    name: checkName,
    head_sha: context.sha,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    conclusion: numErr ? 'failure' : 'success',
    output: {
      title: `${numErr || 'No'} error${numErr != 1 ? 's' : ''}`,
      summary: `Parsiphae found ${numErr || 'no'} syntax error${numErr != 1 ? 's' : ''}`,
      text: details,
      annotations: annotations
    }
  });

  // Refer to check run results
  const extraName = (checkName != 'Parsiphae') ? ' (' + checkName + ')' : ''
  core.notice(`Find the detailed Parsiphae${extraName} results at ${details_url}`);

  // Mark as always successful
  return true;
};
