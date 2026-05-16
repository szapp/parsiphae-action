import fs from 'node:fs'
import path from 'node:path'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'

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
const runnerOs = process.env.RUNNER_OS
const runnerArch = process.env.RUNNER_ARCH
process.env.RUNNER_TEMP = tempPath
process.env.RUNNER_TOOL_CACHE = cachePath
process.env.GITHUB_WORKSPACE = workspacePath
process.env.GITHUB_STEP_SUMMARY = stepSummaryPath

// Mock the GitHub Actions libraries
vi.mock(import('@actions/core'), async (importOriginal) => {
  const originalModule = await importOriginal()
  return {
    ...originalModule,
  }
})
const getInputMock = vi.spyOn(core, 'getInput')
const getBooleanInputMock = vi.spyOn(core, 'getBooleanInput')
const setFailedMock = vi.spyOn(core, 'setFailed')

vi.mock(import('@actions/cache'), async (importOriginal) => {
  const originalModule = await importOriginal()
  return {
    ...originalModule,
  }
})
const saveCacheMock = vi.spyOn(cache, 'saveCache')
const restoreCacheMock = vi.spyOn(cache, 'restoreCache')

// Mock the GitHub API
const createCheckMock = vi.fn((_params) => ({ data: { html_url: 'https://example.com' } }))
vi.mock('@actions/github', () => {
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
      workflow: 'workflow.yml',
    },
  }
})

import * as cleanup from './cleanup.js'
import * as main from './main.js'

const workflowMock = vi.spyOn(cleanup, 'workflow')
const runMock = vi.spyOn(main, 'run')

describe('action', () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    getInputMock.mockImplementation((_) => '')
    getBooleanInputMock.mockImplementation((_) => false)
    setFailedMock.mockImplementation(() => {})
    saveCacheMock.mockResolvedValue(0)
    restoreCacheMock.mockResolvedValue('')
    workflowMock.mockResolvedValue(false)
    fs.mkdirSync(tempPath, { recursive: true })
    fs.writeFileSync(stepSummaryPath, '')
  })

  afterAll(async () => {
    await Promise.allSettled(
      cleanPaths.map((p) => fs.rm(p, { recursive: true, force: true }, () => {})),
    )
  })

  test('parses test file', async () => {
    getInputMock.mockImplementation((name) => {
      switch (name) {
        case 'file':
          return 'test_data/*.d'
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
      external_id: 'workflow.yml-0',
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
            path: 'test_data/fail.d',
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
      /^<h1>Testing Results<\/h1>\r?\n\r?<table><tr><th>Test result 🔬<\/th><th>Source 📝<\/th><th>Errors ❌<\/th><th>Files #️⃣<\/th><th>Duration ⏰ <\/th><th>Details 📊<\/th><\/tr><tr><td>🔴 Fail<\/td><td>fail\.d<\/td><td>1<\/td><td>1<\/td><td>[^<]+<\/td><td><a href="https:\/\/example\.com">undefined<\/a><\/td><\/tr><tr><td>🟢 Pass<\/td><td>pass\.d<\/td><td>0<\/td><td>1<\/td><td>[^<]+<\/td><td><a href="https:\/\/example\.com">undefined<\/a><\/td><\/tr><\/table>\s*$/

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

  test('sets a failed status for invalid input file pattern', async () => {
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

  test('sets a failed status for an input file with wrong file extension', async () => {
    const relPath = 'src/main.test.ts'
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

  test('returns early on check_run', async () => {
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
