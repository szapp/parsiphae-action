import * as core from '@actions/core'
import * as main from '../src/main'
import path from 'path'
import fs from 'fs'

// Mock the action's main function
const runMock = jest.spyOn(main, 'run')

// Other utilities
const cachePath = path.join(__dirname, 'CACHE')
const tempPath = path.join(__dirname, 'TEMP')
const workspacePath = path.dirname(__dirname)
const binPath = path.join(workspacePath, '.parsiphae-action-bin')
const downloadPath = path.join(workspacePath, '.parsiphae-action-source')
const cleanPaths = [cachePath, tempPath, binPath, downloadPath]
process.env['RUNNER_TEMP'] = tempPath
process.env['RUNNER_TOOL_CACHE'] = cachePath
process.env['GITHUB_WORKSPACE'] = workspacePath

// Mock the GitHub Actions libraries
let debugMock: jest.SpiedFunction<typeof core.debug>
let noticeMock: jest.SpiedFunction<typeof core.notice>
let errorMock: jest.SpiedFunction<typeof core.error>
let getInputMock: jest.SpiedFunction<typeof core.getInput>
let getBooleanInputMock: jest.SpiedFunction<typeof core.getBooleanInput>
let setFailedMock: jest.SpiedFunction<typeof core.setFailed>

// Mock the GitHub API
jest.mock('@actions/github', () => {
  return {
    getOctokit: (_token: string) => {
      return {
        rest: {
          checks: {
            create: () => ({ data: { details_url: 'https://example.com' } }),
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

jest.mock('@actions/cache', () => {
  return {
    saveCache: async (_paths: string[], _key: string): Promise<number> => 0,
    restoreCache: async (_paths: string[], _primaryKey: string): Promise<undefined> => undefined,
  }
})

describe('action', () => {
  beforeEach(async () => {
    jest.clearAllMocks()

    noticeMock = jest.spyOn(core, 'notice').mockImplementation()
    errorMock = jest.spyOn(core, 'error').mockImplementation()
    getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
    getBooleanInputMock = jest.spyOn(core, 'getBooleanInput').mockImplementation()
    setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
  })

  afterAll(async () => {
    await Promise.allSettled(cleanPaths.map((p) => fs.rm(p, { recursive: true, force: true }, () => {})))
  })

  it('parses test file', async () => {
    getInputMock.mockImplementation((name) => {
      switch (name) {
        case 'file':
          return '__tests__/data/fail.d'
        case 'check_name':
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

    await main.run()
    expect(runMock).toHaveReturned()

    expect(errorMock).not.toHaveBeenCalled()
    expect(setFailedMock).not.toHaveBeenCalled()
    expect(noticeMock).toHaveBeenNthCalledWith(1, 'Find the detailed Parsiphae (Testing) results at https://example.com')
  }, 120000)

  it('sets a failed status for invalid input file pattern', async () => {
    const relPath = 'this is not a file'

    getInputMock.mockImplementation((name) => {
      switch (name) {
        case 'file':
          return 'this is not a file'
        default:
          return ''
      }
    })

    await main.run()
    expect(runMock).toHaveReturned()

    expect(setFailedMock).toHaveBeenNthCalledWith(1, `No file found matching '${relPath}'`)
    expect(errorMock).not.toHaveBeenCalled()
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
    expect(errorMock).not.toHaveBeenCalled()
  })
})
