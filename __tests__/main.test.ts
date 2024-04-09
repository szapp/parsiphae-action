import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as main from '../src/main'
import * as cleanup from '../src/cleanup'
import path from 'path'
import fs from 'fs'

// Mock the action's main function
const runMock = jest.spyOn(main, 'run')

// Constants
const parVer = '5cfb63ab29df99073a9fcc551d42652bdb130c74'
const binDirName = '.parsiphae-action-bin'
const downloadDirName = '.parsiphae-action-source'

// Paths and environment variables
const cachePath = path.join(__dirname, 'CACHE')
const tempPath = path.join(__dirname, 'TEMP')
const stepSummaryPath = path.join(tempPath, 'step-summary.html')
const workspacePath = path.dirname(__dirname)
const binPath = path.join(workspacePath, binDirName)
const downloadPath = path.join(workspacePath, downloadDirName)
const cleanPaths = [cachePath, tempPath, binPath, downloadPath]
const runnerOs = process.env['RUNNER_OS']
const runnerArch = process.env['RUNNER_ARCH']
process.env['RUNNER_TEMP'] = tempPath
process.env['RUNNER_TOOL_CACHE'] = cachePath
process.env['GITHUB_WORKSPACE'] = workspacePath
process.env['GITHUB_STEP_SUMMARY'] = stepSummaryPath

// Mock the GitHub Actions libraries
let getInputMock: jest.SpiedFunction<typeof core.getInput>
let getBooleanInputMock: jest.SpiedFunction<typeof core.getBooleanInput>
let setFailedMock: jest.SpiedFunction<typeof core.setFailed>
let saveCacheMock: jest.SpiedFunction<typeof cache.saveCache>
let restoreCacheMock: jest.SpiedFunction<typeof cache.restoreCache>
let workflowMock: jest.SpiedFunction<typeof cleanup.workflow>
jest.spyOn(core, 'startGroup').mockImplementation()
jest.spyOn(core, 'endGroup').mockImplementation()

// Mock the GitHub API
const createCheckMock = jest.fn((_params) => ({ data: { html_url: 'https://example.com' } }))
jest.mock('@actions/github', () => {
  return {
    getOctokit: (_token: string) => {
      return {
        rest: {
          checks: {
            create: createCheckMock,
          },
        },
      }
    },
    context: {
      repo: {
        owner: 'owner',
        repo: 'repo',
      },
      sha: 'sha',
    },
  }
})

describe('action', () => {
  beforeEach(async () => {
    jest.clearAllMocks()

    getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
    getBooleanInputMock = jest.spyOn(core, 'getBooleanInput').mockImplementation()
    setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
    saveCacheMock = jest.spyOn(cache, 'saveCache').mockImplementation()
    restoreCacheMock = jest.spyOn(cache, 'restoreCache').mockImplementation()
    workflowMock = jest.spyOn(cleanup, 'workflow').mockResolvedValue(false)
    fs.mkdirSync(tempPath, { recursive: true })
    fs.writeFileSync(stepSummaryPath, '')
  })

  afterAll(async () => {
    await Promise.allSettled(cleanPaths.map((p) => fs.rm(p, { recursive: true, force: true }, () => {})))
  })

  it('parses test file', async () => {
    getInputMock.mockImplementation((name) => {
      switch (name) {
        case 'file':
          return '__tests__/data/*.d'
        case 'check-name':
          return 'Testing'
        case 'token':
          return 'token'
        default:
          return ''
      }
    })

    getBooleanInputMock.mockImplementation((name) => {
      switch (name) {
        case 'cache':
          return true
        default:
          return false
      }
    })

    const cacheKey = binDirName
    const primaryKey = `${runnerOs}-${runnerArch}-parsiphae-${parVer}`
    const expectedCheck1 = {
      owner: 'owner',
      repo: 'repo',
      name: 'Testing: fail.d',
      head_sha: 'sha',
      started_at: expect.any(String),
      completed_at: expect.any(String),
      conclusion: 'failure',
      output: {
        title: '1 error',
        summary: expect.stringMatching(/^Parsiphae found 1 syntax error \([^)]*\)$/),
        text: expect.any(String),
        annotations: [
          {
            annotation_level: 'failure',
            end_line: 3,
            title: 'Syntax error',
            message: 'Missing semicolon',
            path: '__tests__/data/fail.d',
            start_line: 3,
          },
        ],
      },
    }
    const expectedCheck2 = {
      owner: 'owner',
      repo: 'repo',
      name: 'Testing: pass.d',
      head_sha: 'sha',
      started_at: expect.any(String),
      completed_at: expect.any(String),
      conclusion: 'success',
      output: {
        title: 'No errors',
        summary: expect.stringMatching(/^Parsiphae found no syntax errors \([^)]*\)$/),
        text: expect.any(String),
        annotations: [],
      },
    }
    const expectedSummary =
      /^<h1>Testing Results<\/h1>\r?\n\r?<table><tr><th>Test result 🔬<\/th><th>Source 📝<\/th><th>Errors ❌<\/th><th>Files #️<\/th><th>Duration ⏰ <\/th><th>Details 📊<\/th><\/tr><tr><td>🔴 Fail<\/td><td>fail\.d<\/td><td>1<\/td><td>1<\/td><td>[^<]+<\/td><td><a href="https:\/\/example\.com">undefined<\/a><\/td><\/tr><tr><td>🟢 Pass<\/td><td>pass\.d<\/td><td>0<\/td><td>1<\/td><td>[^<]+<\/td><td><a href="https:\/\/example\.com">undefined<\/a><\/td><\/tr><\/table>\s*$/

    await main.run()
    expect(runMock).toHaveReturned()
    expect(workflowMock).toHaveBeenCalledTimes(1)
    expect(setFailedMock).not.toHaveBeenCalled()
    expect(restoreCacheMock).toHaveBeenNthCalledWith(1, [cacheKey], primaryKey)
    expect(saveCacheMock).toHaveBeenNthCalledWith(1, [cacheKey], primaryKey)
    expect(createCheckMock).toHaveReturnedTimes(2)
    expect(createCheckMock).toHaveBeenCalledWith(expect.objectContaining(expectedCheck1))
    expect(createCheckMock).toHaveBeenCalledWith(expect.objectContaining(expectedCheck2))
    expect(fs.readFileSync(stepSummaryPath, 'utf8')).toMatch(expectedSummary)
  }, 120000)

  it('sets a failed status for invalid input file pattern', async () => {
    const relPath = 'this is not a file'

    getInputMock.mockImplementation((name) => {
      switch (name) {
        case 'file':
          return relPath
        default:
          return ''
      }
    })

    await main.run()
    expect(runMock).toHaveReturned()
    expect(setFailedMock).toHaveBeenNthCalledWith(1, `No file found matching '${relPath}'`)
  })

  it('sets a failed status for an input file with wrong file extension', async () => {
    const relPath = '__tests__/main.test.ts'
    const fullPath = path.resolve(path.join(workspacePath, relPath))

    getInputMock.mockImplementation((name) => {
      switch (name) {
        case 'file':
          return relPath
        default:
          return ''
      }
    })

    await main.run()
    expect(runMock).toHaveReturned()
    expect(setFailedMock).toHaveBeenNthCalledWith(1, `Invalid file extension of '${fullPath}'`)
  })

  it('returns early on check_run', async () => {
    workflowMock.mockResolvedValue(true)

    await main.run()
    expect(runMock).toHaveReturned()
    expect(workflowMock).toHaveBeenCalledTimes(1)
    expect(setFailedMock).not.toHaveBeenCalled()
    expect(restoreCacheMock).not.toHaveBeenCalled()
    expect(saveCacheMock).not.toHaveBeenCalled()
    expect(createCheckMock).not.toHaveBeenCalled()
  })
})
