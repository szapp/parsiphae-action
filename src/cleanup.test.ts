import * as core from '@actions/core'
import * as github from '@actions/github'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// Mock the GitHub API
const getWorkflowRunMock = vi.fn(async (_params) => ({
  data: { workflow_id: 123 },
}))
const listWorkflowRunsMock = vi.fn(async (_params) => ({
  data: {
    workflow_runs: [
      { id: 1, event: 'push', status: 'in_progress' },
      { id: 2, event: 'check_run', status: 'in_progress' },
      { id: 3, event: 'workflow_run', status: 'completed' },
    ],
  },
}))
const listWorkflowRunsForRepoMock = vi.fn(async (_params) => ({
  data: {
    workflow_runs: [] as { id: number; event: string }[],
  },
}))
const deleteWorkflowRunMock = vi.fn(async (_params) => {})
vi.mock('@actions/github', () => {
  return {
    getOctokit: (_token: string) => {
      return {
        rest: {
          actions: {
            getWorkflowRun: getWorkflowRunMock,
            listWorkflowRuns: listWorkflowRunsMock,
            listWorkflowRunsForRepo: listWorkflowRunsForRepoMock,
            deleteWorkflowRun: deleteWorkflowRunMock,
          },
        },
      }
    },
    context: {
      eventName: 'check_run',
      workflow: 'workflow.yml',
      payload: {
        action: 'completed',
        check_run: {
          head_sha: 'abc123',
          external_id: 'workflow.yml-0',
          name: 'Patch Validator',
          html_url: 'https://example.com/check_run',
          conclusion: 'success',
        },
      },
      repo: {
        owner: 'owner',
        repo: 'repo',
      },
      runId: 2,
    },
  }
})

// Mock the core module
vi.mock('@actions/core', () => ({
  summary: {
    addHeading: vi.fn(() => core.summary),
    addRaw: vi.fn(() => core.summary),
    write: vi.fn(),
  },
  info: vi.fn(),
  setFailed: vi.fn(),
  getInput: vi.fn(() => 'CheckName'),
}))

import { workflow } from './cleanup.js'

describe('cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should return false if the event is not check_run or action is not completed', async () => {
    github.context.eventName = 'push'
    github.context.payload.action = 'created'

    const result = await workflow()

    expect(result).toBe(false) // Continue workflow run
    expect(deleteWorkflowRunMock).not.toHaveBeenCalled() // Delete nothing
    expect(core.summary.write).not.toHaveBeenCalled() // Write nothing to summary
    expect(core.setFailed).not.toHaveBeenCalled() // Did not cancel
  })

  test('should fail when run with the incorrect check_un', async () => {
    github.context.eventName = 'check_run'
    github.context.payload.action = 'completed'
    github.context.payload.check_run.conclusion = 'failure'
    github.context.payload.check_run.external_id = 'workflow.yml-1'
    process.exitCode = undefined

    const result = await workflow(0)

    expect(result).toBe(true) // Stop workflow run
    expect(deleteWorkflowRunMock).not.toHaveBeenCalled() // Delete nothing
    expect(core.summary.write).not.toHaveBeenCalled() // Write nothing to summary
    expect(core.setFailed).toHaveBeenCalled() // Emit failed status
  })

  test('should delete workflow runs and set exit code if the event is check_run and action is completed', async () => {
    github.context.eventName = 'check_run'
    github.context.payload.action = 'completed'
    github.context.payload.check_run.conclusion = 'success'
    github.context.payload.check_run.external_id = 'workflow.yml-0'
    process.exitCode = undefined
    listWorkflowRunsForRepoMock.mockResolvedValueOnce({
      data: {
        workflow_runs: [{ id: 1, event: 'push' }],
      },
    })

    const result = await workflow(0)

    expect(result).toBe(true) // Stop workflow run
    expect(listWorkflowRunsForRepoMock).toHaveBeenCalledWith({
      ...github.context.repo,
      status: 'in_progress',
      head_sha: github.context.payload.check_run.head_sha,
    })
    expect(listWorkflowRunsForRepoMock).toHaveReturnedWith(
      Promise.resolve({
        data: {
          workflow_runs: [{ id: 1, event: 'push' }],
        },
      }),
    )
    expect(listWorkflowRunsForRepoMock).toHaveBeenCalledTimes(2)
    expect(getWorkflowRunMock).toHaveBeenCalledWith({
      ...github.context.repo,
      run_id: github.context.runId,
    })
    expect(listWorkflowRunsMock).toHaveBeenCalledWith({
      ...github.context.repo,
      workflow_id: 123,
      head_sha: github.context.payload.check_run.head_sha,
    })
    expect(core.info).toHaveBeenCalledWith('Runs to delete: 1(in_progress), 3(completed)')
    expect(deleteWorkflowRunMock).toHaveBeenCalledWith({
      ...github.context.repo,
      run_id: 1,
    })
    expect(deleteWorkflowRunMock).toHaveBeenCalledWith({
      ...github.context.repo,
      run_id: 3,
    })
    expect(core.summary.addHeading).toHaveBeenCalledWith(github.context.payload.check_run.name)
    expect(core.summary.addRaw).toHaveBeenCalledWith(
      `<a href="${github.context.payload.check_run.html_url}">Details</a>`,
      true,
    )
    expect(core.summary.write).toHaveBeenCalledWith({ overwrite: false })
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(0)
  })

  test('should handle errors when deleting workflow runs', async () => {
    github.context.eventName = 'check_run'
    github.context.payload.action = 'completed'
    github.context.payload.check_run.conclusion = 'failure'
    github.context.payload.check_run.external_id = 'workflow.yml-0'
    deleteWorkflowRunMock.mockRejectedValueOnce(new Error('Delete error'))
    process.exitCode = undefined

    const result = await workflow(0)

    expect(result).toBe(true)
    expect(listWorkflowRunsForRepoMock).toHaveBeenCalledWith({
      ...github.context.repo,
      status: 'in_progress',
      head_sha: github.context.payload.check_run.head_sha,
    })
    expect(getWorkflowRunMock).toHaveBeenCalledWith({
      ...github.context.repo,
      run_id: github.context.runId,
    })
    expect(listWorkflowRunsMock).toHaveBeenCalledWith({
      ...github.context.repo,
      workflow_id: 123,
      head_sha: github.context.payload.check_run.head_sha,
    })
    expect(core.info).toHaveBeenCalledWith('Runs to delete: 1(in_progress), 3(completed)')
    expect(deleteWorkflowRunMock).toHaveBeenCalledWith({
      ...github.context.repo,
      run_id: 1,
    })
    expect(deleteWorkflowRunMock).toHaveBeenCalledWith({
      ...github.context.repo,
      run_id: 3,
    })
    expect(core.summary.addHeading).toHaveBeenCalledWith(github.context.payload.check_run.name)
    expect(core.summary.addRaw).toHaveBeenCalledWith(
      `<a href="${github.context.payload.check_run.html_url}">Details</a>`,
      true,
    )
    expect(core.summary.write).toHaveBeenCalledWith({ overwrite: false })
    expect(core.info).toHaveBeenCalledWith(`\u001b[31m${new Error('Delete error')}\u001b[0m`)
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(0)
  })
})
