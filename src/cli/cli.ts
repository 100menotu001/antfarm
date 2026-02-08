#!/usr/bin/env node
import { installWorkflow } from "../installer/install.js";
import { uninstallAllWorkflows, uninstallWorkflow } from "../installer/uninstall.js";
import { getWorkflowStatus, listRuns } from "../installer/status.js";
import { runWorkflow } from "../installer/run.js";
import { listBundledWorkflows } from "../installer/workflow-fetch.js";
import { readRecentLogs } from "../lib/logger.js";
import { startDashboard } from "../server/dashboard.js";

function printUsage() {
  process.stdout.write(
    [
      "antfarm install                      Install all bundled workflows + agent crons",
      "",
      "antfarm workflow list                List available workflows",
      "antfarm workflow install <name>      Install a workflow",
      "antfarm workflow uninstall <name>    Uninstall a workflow",
      "antfarm workflow uninstall --all     Uninstall all workflows",
      "antfarm workflow run <name> <task>   Start a workflow run",
      "antfarm workflow status <query>      Check run status (task substring, run ID prefix)",
      "antfarm workflow runs                List all workflow runs",
      "",
      "antfarm dashboard [<port>]            Start web dashboard (default: 3333)",
      "",
      "antfarm logs [<lines>]               Show recent log entries",
    ].join("\n") + "\n",
  );
}

async function main() {
  const args = process.argv.slice(2);
  const [group, action, target] = args;

  if (group === "install" && !args[1]) {
    const workflows = await listBundledWorkflows();
    if (workflows.length === 0) { console.log("No bundled workflows found."); return; }

    console.log(`Installing ${workflows.length} workflow(s)...`);
    for (const workflowId of workflows) {
      try {
        await installWorkflow({ workflowId });
        console.log(`  ✓ ${workflowId}`);
      } catch (err) {
        console.log(`  ✗ ${workflowId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`\nDone. Start a workflow with: antfarm workflow run <name> "your task"`);
    return;
  }

  if (group === "dashboard") {
    const port = parseInt(args[1], 10) || 3333;
    startDashboard(port);
    // Try to open browser
    const { exec: execCmd } = await import("node:child_process");
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execCmd(`${openCmd} http://localhost:${port}`, () => {});
    return;
  }

  if (group === "logs") {
    const lines = parseInt(args[1], 10) || 50;
    const logs = await readRecentLogs(lines);
    if (logs.length === 0) { console.log("No logs yet."); } else { for (const line of logs) console.log(line); }
    return;
  }

  if (args.length < 2) { printUsage(); process.exit(1); }
  if (group !== "workflow") { printUsage(); process.exit(1); }

  if (action === "runs") {
    const runs = listRuns();
    if (runs.length === 0) { console.log("No workflow runs found."); return; }
    console.log("Workflow runs:");
    for (const r of runs) {
      console.log(`  [${r.status.padEnd(9)}] ${r.id.slice(0, 8)}  ${r.workflow_id.padEnd(14)}  ${r.task.slice(0, 50)}${r.task.length > 50 ? "..." : ""}`);
    }
    return;
  }

  if (action === "list") {
    const workflows = await listBundledWorkflows();
    if (workflows.length === 0) { process.stdout.write("No workflows available.\n"); } else {
      process.stdout.write("Available workflows:\n");
      for (const w of workflows) process.stdout.write(`  ${w}\n`);
    }
    return;
  }

  if (!target) { printUsage(); process.exit(1); }

  if (action === "install") {
    const result = await installWorkflow({ workflowId: target });
    process.stdout.write(`Installed workflow: ${result.workflowId}\nAgent cron jobs created.\n`);
    process.stdout.write(`\nStart with: antfarm workflow run ${result.workflowId} "your task"\n`);
    return;
  }

  if (action === "uninstall") {
    if (target === "--all" || target === "all") { await uninstallAllWorkflows(); } else { await uninstallWorkflow({ workflowId: target }); }
    return;
  }

  if (action === "status") {
    const query = args.slice(2).join(" ").trim();
    if (!query) { process.stderr.write("Missing search query.\n"); printUsage(); process.exit(1); }
    const result = getWorkflowStatus(query);
    if (result.status === "not_found") { process.stdout.write(`${result.message}\n`); return; }
    const { run, steps } = result;
    process.stdout.write(
      [
        `Run: ${run.id}`,
        `Workflow: ${run.workflow_id}`,
        `Task: ${run.task.slice(0, 120)}${run.task.length > 120 ? "..." : ""}`,
        `Status: ${run.status}`,
        `Created: ${run.created_at}`,
        `Updated: ${run.updated_at}`,
        "",
        "Steps:",
        ...steps.map((s) => `  [${s.status}] ${s.step_id} (${s.agent_id})`),
      ].join("\n") + "\n",
    );
    return;
  }

  if (action === "run") {
    const taskTitle = args.slice(3).join(" ").trim();
    if (!taskTitle) { process.stderr.write("Missing task title.\n"); printUsage(); process.exit(1); }
    const run = await runWorkflow({ workflowId: target, taskTitle });
    process.stdout.write(
      [`Run: ${run.id}`, `Workflow: ${run.workflowId}`, `Task: ${run.task}`, `Status: ${run.status}`].join("\n") + "\n",
    );
    return;
  }

  process.stderr.write(`Unknown action: ${action}\n`);
  printUsage();
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
