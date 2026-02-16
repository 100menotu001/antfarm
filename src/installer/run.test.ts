import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { runWorkflow } from "./run.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// Helper to create a minimal workflow spec for testing
function createTestWorkflow(workflowId: string) {
  const workflowDir = join(os.homedir(), ".openclaw", "antfarm", "workflows", workflowId);
  mkdirSync(workflowDir, { recursive: true });
  
  const yaml = `id: ${workflowId}
title: Test Workflow
context: {}
notifications: {}
agents:
  - id: testagent
    workspace:
      baseDir: /tmp
      files:
        testfile: file.txt
steps:
  - id: step1
    agent: testagent
    input: test input
    expects: test output
`;
  
  writeFileSync(join(workflowDir, "workflow.yml"), yaml);
  
  return workflowDir;
}

// Helper to cleanup test run from database
function cleanupTestRun(runId: string) {
  const db = getDb();
  db.prepare("DELETE FROM steps WHERE run_id = ?").run(runId);
  db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
}

describe("runWorkflow - dry_run context variable", () => {
  const testRunIds: string[] = [];
  const workflowIds: string[] = [];

  afterEach(() => {
    for (const runId of testRunIds) {
      cleanupTestRun(runId);
    }
    testRunIds.length = 0;
  });

  it("sets context.dry_run to 'false' by default when dryRun parameter is undefined", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test task without dryRun parameter",
    });
    testRunIds.push(result.id);

    // Query the database to verify context.dry_run is set to 'false'
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    assert.equal(context.dry_run, "false", "dry_run should be 'false' by default");
  });

  it("sets context.dry_run to 'false' when dryRun=false is explicitly provided", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test task with dryRun=false",
      dryRun: false,
    });
    testRunIds.push(result.id);

    // Query the database to verify context.dry_run is set to 'false'
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    assert.equal(context.dry_run, "false", "dry_run should be 'false' when explicitly false");
  });

  it("sets context.dry_run to 'true' when dryRun=true is provided", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test task with dryRun=true",
      dryRun: true,
    });
    testRunIds.push(result.id);

    // Query the database to verify context.dry_run is set to 'true'
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    assert.equal(context.dry_run, "true", "dry_run should be 'true' when explicitly true");
  });

  it("initializes dry_run as a string 'false' not boolean false", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test task for type check",
    });
    testRunIds.push(result.id);

    // Query the database to verify context.dry_run is a string
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    assert.strictEqual(typeof context.dry_run, "string", "dry_run should be a string type");
    assert.strictEqual(context.dry_run, "false", "dry_run should be the string 'false'");
  });

  it("includes task in context alongside dry_run", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const taskTitle = "Test task with dry_run and task fields";
    const result = await runWorkflow({
      workflowId,
      taskTitle,
    });
    testRunIds.push(result.id);

    // Query the database to verify both task and dry_run are set
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    assert.equal(context.task, taskTitle, "task should be in context");
    assert.equal(context.dry_run, "false", "dry_run should be in context");
  });

  it("creates a run record with dry_run in context as JSON string", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test task for JSON context",
    });
    testRunIds.push(result.id);

    // Verify the run was created with proper context JSON
    const db = getDb();
    const run = db
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(result.id) as {
      id: string;
      context: string;
      status: string;
      workflow_id: string;
    };

    assert.ok(run, "run should exist in database");
    assert.equal(run.status, "running", "run status should be running");
    assert.equal(run.workflow_id, workflowId, "workflow_id should match");

    // Verify context is valid JSON with dry_run
    let context;
    try {
      context = JSON.parse(run.context);
    } catch {
      assert.fail("context should be valid JSON");
    }
    assert.ok(context.dry_run !== undefined, "context should have dry_run field");
  });
});
