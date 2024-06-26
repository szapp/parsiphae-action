import * as core from '@actions/core'
import * as github from '@actions/github'
import { setTimeout } from 'timers/promises'

export async function workflow(): Promise<boolean> {
  // Only for completed check runs
  if (github.context.eventName !== 'check_run' || github.context.payload.action !== 'completed') return false

  // Check if the triggering check run is the correct one
  if (github.context.payload.check_run.external_id !== `${github.context.workflow}-0`) {
    // This workflow run here will then be also deleted by the correctly triggered run
    core.setFailed('This action is only intended to be run on the first check run of the workflow only')
    return true
  }

  const octokit = github.getOctokit(core.getInput('cleanup-token'))

  // Let all running workflows finish
  let status: boolean
  do {
    core.info('Waiting for any workflow runs to finish...')
    await setTimeout(15000) // Give some time for all workflows to start up
    const {
      data: { workflow_runs },
    } = await octokit.rest.actions.listWorkflowRunsForRepo({
      ...github.context.repo,
      status: 'in_progress',
      head_sha: github.context.payload.check_run.head_sha,
    })
    status = workflow_runs.some((w) => w.event !== 'check_run')
  } while (status)

  // First, get the workflow ID
  const {
    data: { workflow_id },
  } = await octokit.rest.actions.getWorkflowRun({
    ...github.context.repo,
    run_id: github.context.runId,
  })

  // Then, list all workflow runs for the same commit and workflow
  const {
    data: { workflow_runs },
  } = await octokit.rest.actions.listWorkflowRuns({
    ...github.context.repo,
    workflow_id,
    head_sha: github.context.payload.check_run.head_sha,
  })

  // Exclude the current workflow run
  const workflows = workflow_runs.filter((w) => w.id !== github.context.runId)

  // Find success across all workflow runs (non-check runs)
  const failure = workflows.filter((w) => w.event !== 'check_run').some((w) => ['failure', 'cancelled'].includes(w.conclusion ?? ''))

  // Delete all workflow runs
  core.info(`Runs to delete: ${workflows.map((w) => `${w.id}(${w.status})`).join(', ')}`)
  Promise.allSettled(
    workflows.map((w) =>
      octokit.rest.actions
        .deleteWorkflowRun({
          ...github.context.repo,
          run_id: w.id,
        })
        .catch((error) => core.info(`\u001b[31m${error}\u001b[0m`))
    )
  )

  // The summary of the workflow runs is unfortunately not available in the API
  // So we can only link to the check run
  await core.summary
    .addHeading(github.context.payload.check_run.name)
    .addRaw(`<a href="${github.context.payload.check_run.html_url}">Details</a>`, true)
    .write({ overwrite: false })

  // To be able to use a badge, we need to set the exit code
  // Note: This does not reflect the status of the check run but across all workflow runs
  process.exitCode = Number(failure)

  // True means we stop here
  return true
}
