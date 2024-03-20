import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as glob from '@actions/glob'
import * as io from '@actions/io'
import * as tc from '@actions/tool-cache'

// Parsiphae version  (branch, tag, or sha)
const parVer = 'master'

// File path patterns
const regexPreDot = /^\.\//
const regexWinSlash = /\\+/g
const regexPreSlash = /^[\\|/]+/
const regexExt = /\.(d|src)$/i
const regexExtD = /^.*\.d$/i
const regexExtSrc = /^.*\.src$/i

// Output message patterns
const regexNL = /\r?\n/g
const regexFile = /(?<=in file ").+(?=")/
const regexLine = /(?<=in line )[0-9]+/
const regexMsg = /(?<=: ).+/
const regexParsed = /Parsed |parsing took/

export async function run(): Promise<void> {
  try {
    core.startGroup('Format inputs')
    const inputFile = core.getInput('file', { required: true })
    const githubToken = core.getInput('token')
    const checkName = core.getInput('check_name')
    const doCache = core.getBooleanInput('cache')
    const { GITHUB_WORKSPACE: workspace, RUNNER_OS: runnerOs, RUNNER_ARCH: runnerArch } = process.env
    const exeName = process.platform === 'win32' ? 'parsiphae.exe' : 'parsiphae'

    // Match file pattern
    const filepath = inputFile.replace(regexWinSlash, '/').replace(regexPreDot, '')
    const files = await glob.create(filepath).then((g) => g.glob().then((f) => f.sort()))
    const numFiles = files.length
    if (!numFiles) throw new Error(`No file found matching '${inputFile}'`)
    core.endGroup()

    // Verify files
    core.startGroup('Verify input files')
    files.forEach((file) => {
      core.info(file)
      if (!regexExt.test(file)) throw new Error(`Invalid file extension of '${file}'`)
    })
    core.endGroup()

    // Restore Parsiphae built from cache (if found)
    let cacheKey = undefined
    const primaryKey = `${runnerOs}-${runnerArch}-parsiphae-${parVer}`
    const cachePath = '.parsiphae-action-bin'
    if (doCache) {
      core.startGroup(`Try to restore Parisphae built (${parVer}) from cache`)
      cacheKey = await cache.restoreCache([cachePath], primaryKey)
      if (!cacheKey) core.info(`No cache hit for ${primaryKey}`)
      core.endGroup()
    }

    // Build Parsiphae (if not cached)
    if (!cacheKey) {
      core.startGroup(`Built (${parVer}) Parsiphae`)
      core.info('Download Parsiphae')
      const parSrcPath = '.parsiphae-action-source'
      const archivePath = await tc.downloadTool(`https://github.com/Lehona/Parsiphae/archive/${parVer}.tar.gz`)

      core.info('Extract Parsiphae')
      await io.mkdirP(parSrcPath)
      await tc.extractTar(archivePath, parSrcPath)
      await io.rmRF(archivePath)

      core.info('Build Parsiphae')
      await exec.exec('cargo', ['build', '--release'], { cwd: `${parSrcPath}/Parsiphae-${parVer}` })

      core.info('Move executable')
      const targetPath = `${parSrcPath}/Parsiphae-${parVer}/target/release/${exeName}`
      await io.mkdirP(cachePath)
      await io.mv(targetPath, cachePath)
      await io.rmRF(parSrcPath)

      if (doCache) {
        core.info('Cache Parsiphae')
        await cache.saveCache([cachePath], primaryKey)
      }
      core.endGroup()
    }
    core.addPath(cachePath)

    // Record stdout and stderr for exec
    let stdout = ''
    let stderr: string[] = []
    const execOpt: exec.ExecOptions = {
      listeners: {
        stdout: (data: Buffer): void => {
          stdout += data.toString()
        },
        errline: (str: string): void => {
          stderr.push(str)
        },
      },
      ignoreReturnCode: true,
    }

    // Windows does not provide new lines, disrupting the capture of stderr through errline,
    // see https://github.com/actions/toolkit/issues/1313
    /* istanbul ignore next */
    if (process.platform === 'win32') {
      delete execOpt.listeners?.errline
      execOpt.listeners!.stderr = (data: Buffer): void => {
        stderr.push(...data.toString().split(regexNL))
      }
    }

    // Get relative path
    const stripWorkspace = (p: string): string => {
      return core.toPosixPath(
        p
          .replace(regexWinSlash, '\\')
          .replace(workspace ?? '', '')
          .replace(regexPreSlash, '')
      )
    }

    // Prepare git
    const octokit = github.getOctokit(githubToken)

    // Process input file(s)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const srcfile = stripWorkspace(file)
      const extFlag = file.replace(regexExtSrc, 's').replace(regexExtD, 'i')

      await core.group(`Parse ${srcfile}`, async (): Promise<void> => {
        stdout = ''
        stderr = []
        await exec.exec(exeName, [`-${extFlag}`, file], execOpt)

        // Iterate over reported errors
        const annotations: { path: string; start_line: number; end_line: number; annotation_level: 'failure'; message: string }[] = []
        stderr.forEach((line) => {
          if (!line.length) return
          const linenum = +(line.match(regexLine) || ['0'])[0]
          const message = (line.match(regexMsg) || ['invalid'])[0]
          const path = (line.match(regexFile) || ['invalid'])[0]
          const filename = stripWorkspace(path)
          annotations.push({
            path: filename,
            start_line: linenum,
            end_line: linenum,
            annotation_level: 'failure',
            message: message,
          })
        })

        // Construct detailed information
        const pos = stdout.search(regexParsed)
        let tree = stdout.substring(0, pos - 1).trim()
        if (tree) {
          tree = `<details><summary>Summary</summary><pre>${tree}</pre></details>`
        }
        const info = stdout.substring(pos)
        const link = `https://github.com/Lehona/Parsiphae/tree/${parVer}`
        const details = `Parsiphae parsed \`${srcfile}\`.

${tree}

${info}

For more details on Parsiphae, see [Lehona/Parsiphae@${parVer}](${link}).`

        // Create Gitub check run
        const checkRunName = numFiles > 1 ? `${checkName}: ${srcfile}` : checkName
        const numErr = annotations.length
        const {
          data: { details_url },
        } = await octokit.rest.checks.create({
          ...github.context.repo,
          name: checkRunName,
          head_sha: github.context.sha,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          conclusion: numErr ? 'failure' : 'success',
          output: {
            title: `${numErr || 'No'} error${numErr !== 1 ? 's' : ''}`,
            summary: `Parsiphae found ${numErr || 'no'} syntax error${numErr !== 1 ? 's' : ''}`,
            text: details,
            annotations: annotations,
          },
        })

        // Refer to check run results
        let extraName = ''
        if (checkName !== 'Parsiphae') {
          extraName = ` (${checkRunName})`
        } else if (checkName !== checkRunName) {
          extraName = ` (${srcfile})`
        }
        core.notice(`Find the detailed Parsiphae${extraName} results at ${details_url}`)
      })
    }
  } catch (error) {
    const msg: string = error instanceof Error ? error.message : String(error)
    core.setFailed(msg)
  }
}
