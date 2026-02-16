import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { runWorkflow } from "./run.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// Helper to create a minimal workflow spec for testing
function createTestWorkflow(workflowId: string, customContext?: Record<string, string>) {
  const workflowDir = join(os.homedir(), ".openclaw", "antfarm", "workflows", workflowId);
  mkdirSync(workflowDir, { recursive: true });
  
  // Convert custom context to YAML format, quoting all values to ensure they're strings
  let contextYaml = "context: {}";
  if (customContext && Object.keys(customContext).length > 0) {
    contextYaml = "context:\n";
    for (const [key, value] of Object.entries(customContext)) {
      // Quote all values to ensure YAML parser treats them as strings
      contextYaml += `  ${key}: "${value}"\n`;
    }
  }
  
  const yaml = `id: ${workflowId}
title: Test Workflow
${contextYaml}
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

// Helper to create a workflow with multiple steps for testing
function createTestWorkflowWithMultipleSteps(workflowId: string, stepCount: number, customContext?: Record<string, string>) {
  const workflowDir = join(os.homedir(), ".openclaw", "antfarm", "workflows", workflowId);
  mkdirSync(workflowDir, { recursive: true });
  
  // Convert custom context to YAML format, quoting all values to ensure they're strings
  let contextYaml = "context: {}";
  if (customContext && Object.keys(customContext).length > 0) {
    contextYaml = "context:\n";
    for (const [key, value] of Object.entries(customContext)) {
      // Quote all values to ensure YAML parser treats them as strings
      contextYaml += `  ${key}: "${value}"\n`;
    }
  }
  
  // Generate steps YAML dynamically based on stepCount
  let stepsYaml = "steps:\n";
  for (let i = 1; i <= stepCount; i++) {
    stepsYaml += `  - id: step${i}\n`;
    stepsYaml += `    agent: testagent\n`;
    stepsYaml += `    input: test input ${i}\n`;
    stepsYaml += `    expects: test output ${i}\n`;
  }
  
  const yaml = `id: ${workflowId}
title: Test Workflow
${contextYaml}
notifications: {}
agents:
  - id: testagent
    workspace:
      baseDir: /tmp
      files:
        testfile: file.txt
${stepsYaml}`;
  
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

describe("dry_run context is accessible in step templates", () => {
  const testRunIds: string[] = [];
  const workflowIds: string[] = [];

  afterEach(() => {
    for (const runId of testRunIds) {
      cleanupTestRun(runId);
    }
    testRunIds.length = 0;
  });

  it("dry_run context variable is included in run context JSON stored in database", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test dry_run in context",
      dryRun: true,
    });
    testRunIds.push(result.id);

    // Query database for run context
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    assert.ok("dry_run" in context, "dry_run should be in context");
    assert.equal(context.dry_run, "true", "dry_run should be 'true' when dryRun=true");
  });

  it("context JSON is valid and parseable", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test context JSON validity",
      dryRun: false,
    });
    testRunIds.push(result.id);

    // Query database and verify context is valid JSON
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    let parsedContext: Record<string, string>;
    try {
      parsedContext = JSON.parse(run.context);
    } catch (err) {
      assert.fail(`context should be valid JSON, got error: ${(err as Error).message}`);
    }

    // Verify context has expected fields
    assert.ok(parsedContext, "context should parse successfully");
    assert.ok("dry_run" in parsedContext, "parsed context should have dry_run field");
    assert.ok("task" in parsedContext, "parsed context should have task field");
  });

  it("dry_run is available for template interpolation via {{dry_run}} placeholders", async () => {
    const { resolveTemplate } = await import("./step-ops.js");

    // Test template with dry_run placeholder
    const template = "Running in mode: {{dry_run}}";
    const context: Record<string, string> = {
      dry_run: "true",
      task: "Test task",
    };

    const resolved = resolveTemplate(template, context);
    assert.equal(resolved, "Running in mode: true", "{{dry_run}} placeholder should be replaced");
  });

  it("dry_run placeholder resolution works for both true and false values", async () => {
    const { resolveTemplate } = await import("./step-ops.js");

    // Test with dry_run = "true"
    const contextTrue: Record<string, string> = { dry_run: "true" };
    const resolvedTrue = resolveTemplate("{{dry_run}}", contextTrue);
    assert.equal(resolvedTrue, "true", "{{dry_run}} should resolve to 'true'");

    // Test with dry_run = "false"
    const contextFalse: Record<string, string> = { dry_run: "false" };
    const resolvedFalse = resolveTemplate("{{dry_run}}", contextFalse);
    assert.equal(resolvedFalse, "false", "{{dry_run}} should resolve to 'false'");
  });

  it("context from database can be used for template resolution", async () => {
    const { resolveTemplate } = await import("./step-ops.js");
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    // Create run with dryRun=true
    const result = await runWorkflow({
      workflowId,
      taskTitle: "Template resolution test",
      dryRun: true,
    });
    testRunIds.push(result.id);

    // Retrieve context from database
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);

    // Use context to resolve template
    const template = "Task: {{task}}, Dry run: {{dry_run}}";
    const resolved = resolveTemplate(template, context);

    assert.equal(
      resolved,
      "Task: Template resolution test, Dry run: true",
      "template should resolve using database context"
    );
  });

  it("multiple context variables including dry_run work in complex templates", async () => {
    const { resolveTemplate } = await import("./step-ops.js");

    const context: Record<string, string> = {
      task: "Deploy app",
      dry_run: "false",
      run_id: "abc123",
      branch: "main",
    };

    const template =
      "Task: {{task}} | Branch: {{branch}} | Dry run: {{dry_run}} | Run ID: {{run_id}}";
    const resolved = resolveTemplate(template, context);

    assert.equal(
      resolved,
      "Task: Deploy app | Branch: main | Dry run: false | Run ID: abc123",
      "complex template with dry_run should resolve correctly"
    );
  });

  it("missing dry_run in context returns [missing: dry_run] placeholder", async () => {
    const { resolveTemplate } = await import("./step-ops.js");

    const context: Record<string, string> = {
      task: "Some task",
    };

    const template = "Dry run mode: {{dry_run}}";
    const resolved = resolveTemplate(template, context);

    assert.equal(
      resolved,
      "Dry run mode: [missing: dry_run]",
      "missing dry_run should show placeholder"
    );
  });

  it("dry_run is present after multiple context updates", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test context updates",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();

    // Initial context should have dry_run
    let run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };
    let context = JSON.parse(run.context);
    assert.equal(context.dry_run, "true", "initial context should have dry_run");

    // Simulate updating context (as step-ops.ts does)
    context.new_field = "new_value";
    db.prepare("UPDATE runs SET context = ? WHERE id = ?").run(
      JSON.stringify(context),
      result.id
    );

    // Verify dry_run still exists after update
    run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };
    context = JSON.parse(run.context);
    assert.equal(context.dry_run, "true", "dry_run should persist after context updates");
    assert.equal(context.new_field, "new_value", "new fields should be preserved");
  });
});

describe("US-004: Unit test: Verify task and dry_run both present in context", () => {
  const testRunIds: string[] = [];
  const workflowIds: string[] = [];

  afterEach(() => {
    for (const runId of testRunIds) {
      cleanupTestRun(runId);
    }
    testRunIds.length = 0;
  });

  it("verifies context contains both task and dry_run fields with correct values", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    const specificTaskTitle = "Verify task and dry_run both present in context";
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    // Call runWorkflow with a specific task title
    const result = await runWorkflow({
      workflowId,
      taskTitle: specificTaskTitle,
      dryRun: false,
    });
    testRunIds.push(result.id);

    // Query database for run context
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    // Verify context is valid JSON
    let context;
    try {
      context = JSON.parse(run.context);
    } catch (err) {
      assert.fail(`context should be valid parseable JSON, got error: ${(err as Error).message}`);
    }

    // Verify context contains 'task' field matching task title
    assert.ok("task" in context, "context should contain 'task' field");
    assert.equal(context.task, specificTaskTitle, "task field should match provided task title");

    // Verify context contains 'dry_run' field with correct value
    assert.ok("dry_run" in context, "context should contain 'dry_run' field");
    assert.equal(context.dry_run, "false", "dry_run field should have correct value 'false'");
  });

  it("verifies context contains task and dry_run when dryRun=true", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    const taskTitle = "Test task with dryRun enabled";
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    // Call runWorkflow with dryRun=true
    const result = await runWorkflow({
      workflowId,
      taskTitle,
      dryRun: true,
    });
    testRunIds.push(result.id);

    // Query database and verify both fields exist
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    // Verify JSON is parseable
    const context = JSON.parse(run.context);

    // Verify both fields are present
    assert.ok("task" in context, "task field should be present");
    assert.ok("dry_run" in context, "dry_run field should be present");

    // Verify values are correct
    assert.equal(context.task, taskTitle, "task should match provided title");
    assert.equal(context.dry_run, "true", "dry_run should be 'true'");
  });

  it("verifies context contains task and dry_run when dryRun parameter is undefined", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    const taskTitle = "Test task without dryRun parameter";
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    // Call runWorkflow without dryRun parameter (should default to false)
    const result = await runWorkflow({
      workflowId,
      taskTitle,
    });
    testRunIds.push(result.id);

    // Verify both fields are present in context
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);

    // Both fields must be present
    assert.ok("task" in context, "task field should be present even without dryRun param");
    assert.ok("dry_run" in context, "dry_run field should be present and default to 'false'");

    // Verify correct values
    assert.equal(context.task, taskTitle, "task field should match provided title");
    assert.equal(context.dry_run, "false", "dry_run should default to 'false'");
  });

  it("verifies context JSON is valid and contains both task and dry_run fields", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Context JSON validation test",
      dryRun: false,
    });
    testRunIds.push(result.id);

    // Get raw context string from database
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    // Verify it's valid JSON by parsing it
    let parsedContext: Record<string, string>;
    try {
      parsedContext = JSON.parse(run.context);
    } catch (err) {
      assert.fail(`context should be valid JSON: ${(err as Error).message}`);
    }

    // Verify both required fields are present
    assert.strictEqual(typeof parsedContext, "object", "parsed context should be an object");
    assert.ok(parsedContext !== null, "parsed context should not be null");
    assert.ok("task" in parsedContext, "parsed context must contain 'task' field");
    assert.ok("dry_run" in parsedContext, "parsed context must contain 'dry_run' field");

    // Verify field types are strings
    assert.strictEqual(typeof parsedContext.task, "string", "task should be a string");
    assert.strictEqual(typeof parsedContext.dry_run, "string", "dry_run should be a string");

    // Verify values are non-empty
    assert.ok(parsedContext.task.length > 0, "task should not be empty");
    assert.ok(["true", "false"].includes(parsedContext.dry_run), "dry_run should be 'true' or 'false'");
  });
});

describe("US-005: Unit test: Verify run record created with dry_run in context", () => {
  const testRunIds: string[] = [];
  const workflowIds: string[] = [];

  afterEach(() => {
    for (const runId of testRunIds) {
      cleanupTestRun(runId);
    }
    testRunIds.length = 0;
  });

  it("verifies run record created with correct workflow_id from database query", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    // Test creates run via runWorkflow
    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test run record creation",
    });
    testRunIds.push(result.id);

    // Test queries run record from database by run ID
    const db = getDb();
    const run = db
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(result.id) as {
      id: string;
      workflow_id: string;
      status: string;
      context: string;
      created_at: string;
      updated_at: string;
    };

    // Verify run exists in database
    assert.ok(run, "run record should exist in database");

    // Test verifies run.workflow_id matches input
    assert.equal(run.workflow_id, workflowId, "run.workflow_id should match the input workflowId");
  });

  it("verifies run record status equals 'running' when created", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test run status",
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT status FROM runs WHERE id = ?")
      .get(result.id) as { status: string };

    // Test verifies run.status equals 'running'
    assert.equal(run.status, "running", "run.status should be 'running' when created");
  });

  it("verifies run record context is valid JSON with dry_run field", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test context JSON with dry_run",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    // Test verifies context is valid JSON
    let context: Record<string, string>;
    try {
      context = JSON.parse(run.context);
    } catch (err) {
      assert.fail(`context should be valid JSON: ${(err as Error).message}`);
    }

    // Verify context has dry_run field
    assert.ok("dry_run" in context, "context should have dry_run field");
    assert.equal(context.dry_run, "true", "dry_run should have correct value");
  });

  it("verifies run record has timestamp fields created_at and updated_at", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test timestamp fields",
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT created_at, updated_at FROM runs WHERE id = ?")
      .get(result.id) as { created_at: string; updated_at: string };

    // Test verifies run has timestamp fields
    assert.ok(run.created_at, "run should have created_at field");
    assert.ok(run.updated_at, "run should have updated_at field");

    // Verify timestamps are valid ISO strings
    const createdDate = new Date(run.created_at);
    const updatedDate = new Date(run.updated_at);
    assert.ok(!isNaN(createdDate.getTime()), "created_at should be a valid timestamp");
    assert.ok(!isNaN(updatedDate.getTime()), "updated_at should be a valid timestamp");
  });

  it("verifies full run record structure with all expected fields", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test full run record structure",
      dryRun: false,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(result.id) as Record<string, any>;

    // Verify all expected fields exist
    assert.ok(run.id, "run should have id field");
    assert.ok(run.workflow_id, "run should have workflow_id field");
    assert.ok(run.status, "run should have status field");
    assert.ok(run.context, "run should have context field");
    assert.ok(run.created_at, "run should have created_at field");
    assert.ok(run.updated_at, "run should have updated_at field");

    // Verify field types and values
    assert.equal(typeof run.id, "string", "id should be a string");
    assert.equal(typeof run.workflow_id, "string", "workflow_id should be a string");
    assert.equal(typeof run.status, "string", "status should be a string");
    assert.equal(typeof run.context, "string", "context should be a string");

    // Verify values are correct
    assert.equal(run.id, result.id, "id should match the returned run ID");
    assert.equal(run.workflow_id, workflowId, "workflow_id should match input");
    assert.equal(run.status, "running", "status should be 'running'");

    // Verify context is valid JSON with dry_run
    const context = JSON.parse(run.context);
    assert.ok("dry_run" in context, "context should have dry_run field");
    assert.equal(context.dry_run, "false", "dry_run should have correct value");
  });
});

describe("US-005-old: dry_run is a string (not boolean) for template compatibility", () => {
  const testRunIds: string[] = [];
  const workflowIds: string[] = [];

  afterEach(() => {
    for (const runId of testRunIds) {
      cleanupTestRun(runId);
    }
    testRunIds.length = 0;
  });

  it("dry_run context variable is type string, not boolean", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test dry_run type is string",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    
    // Verify type is string, not boolean
    assert.strictEqual(typeof context.dry_run, "string", "dry_run type must be string");
    assert.notEqual(typeof context.dry_run, "boolean", "dry_run type must not be boolean");
    assert.strictEqual(context.dry_run, "true", "string value should be 'true'");
  });

  it("dry_run value is either 'true' or 'false' (string literals)", async () => {
    const workflowId1 = `test-workflow-${crypto.randomUUID()}`;
    const workflowId2 = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId1, workflowId2);
    createTestWorkflow(workflowId1);
    createTestWorkflow(workflowId2);

    // Test with dryRun=true
    const result1 = await runWorkflow({
      workflowId: workflowId1,
      taskTitle: "Test true value",
      dryRun: true,
    });
    testRunIds.push(result1.id);

    // Test with dryRun=false
    const result2 = await runWorkflow({
      workflowId: workflowId2,
      taskTitle: "Test false value",
      dryRun: false,
    });
    testRunIds.push(result2.id);

    const db = getDb();
    
    // Verify true case
    let run1 = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result1.id) as { context: string };
    let context1 = JSON.parse(run1.context);
    assert.equal(context1.dry_run, "true", "dry_run with true should be string 'true'");
    assert.ok(
      context1.dry_run === "true" || context1.dry_run === "false",
      "dry_run must be either 'true' or 'false'"
    );

    // Verify false case
    let run2 = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result2.id) as { context: string };
    let context2 = JSON.parse(run2.context);
    assert.equal(context2.dry_run, "false", "dry_run with false should be string 'false'");
    assert.ok(
      context2.dry_run === "true" || context2.dry_run === "false",
      "dry_run must be either 'true' or 'false'"
    );
  });

  it("context JSON serialization maintains string type", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test JSON serialization",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    // Test round-trip: JSON.stringify → JSON.parse → verify type
    const serialized = run.context;
    const context = JSON.parse(serialized);
    const reserialized = JSON.stringify(context);

    // Verify original serialization
    assert.ok(serialized.includes('"dry_run":"true"'), "JSON should contain string value");
    assert.ok(!serialized.includes('"dry_run":true'), "JSON should not contain boolean value");

    // Verify re-serialization maintains type
    const reparsed = JSON.parse(reserialized);
    assert.strictEqual(typeof reparsed.dry_run, "string", "type should remain string after re-serialization");
    assert.equal(reparsed.dry_run, "true", "value should be preserved");
  });

  it("string type dry_run is compatible with template engines expecting strings", async () => {
    const { resolveTemplate } = await import("./step-ops.js");

    // Template engine pattern: concatenate strings
    const context: Record<string, string> = {
      dry_run: "false",
      command: "deploy",
    };

    // Test template that uses dry_run in conditional-like pattern
    const template = "If {{dry_run}} equals 'false', execute {{command}}";
    const resolved = resolveTemplate(template, context);

    // Verify string comparison works
    assert.equal(
      resolved,
      "If false equals 'false', execute deploy",
      "string type should allow comparison with string literals"
    );

    // Test another pattern: string in URL or query parameter
    const urlTemplate = "https://api.example.com/action?dryRun={{dry_run}}&task={{command}}";
    const urlResolved = resolveTemplate(urlTemplate, context);
    assert.equal(
      urlResolved,
      "https://api.example.com/action?dryRun=false&task=deploy",
      "string type should work in URL templates"
    );
  });

  it("dry_run string type is safe for equality comparisons", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test equality comparisons",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);

    // String comparisons
    assert.equal(context.dry_run, "true", "string equality check");
    assert.notEqual(context.dry_run, "false", "string inequality check");
    assert.strictEqual(context.dry_run === "true", true, "strict equality with string literal");
    assert.strictEqual(context.dry_run === true as any, false, "strict equality with boolean should be false");
  });

  it("template engine processes dry_run string correctly in conditional templates", async () => {
    const { resolveTemplate } = await import("./step-ops.js");

    // Simulate template that uses dry_run as a string flag
    const contextDryTrue: Record<string, string> = {
      dry_run: "true",
      action: "log only",
    };

    const contextDryFalse: Record<string, string> = {
      dry_run: "false",
      action: "execute",
    };

    // Template that checks dry_run value
    const template = "Mode: {{dry_run}} → {{action}}";

    const resultTrue = resolveTemplate(template, contextDryTrue);
    assert.equal(resultTrue, "Mode: true → log only", "template should handle dry_run=true as string");

    const resultFalse = resolveTemplate(template, contextDryFalse);
    assert.equal(resultFalse, "Mode: false → execute", "template should handle dry_run=false as string");
  });

  it("context JSON maintains string type across database updates", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test JSON type persistence",
      dryRun: false,
    });
    testRunIds.push(result.id);

    const db = getDb();

    // Retrieve initial context
    let run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };
    let context = JSON.parse(run.context);
    assert.strictEqual(typeof context.dry_run, "string", "initial dry_run should be string");
    assert.equal(context.dry_run, "false", "initial value should be 'false'");

    // Update context (simulate step completion adding more context)
    context.output = "Step completed";
    db.prepare("UPDATE runs SET context = ? WHERE id = ?").run(
      JSON.stringify(context),
      result.id
    );

    // Verify dry_run type is still string after update
    run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };
    context = JSON.parse(run.context);
    
    assert.strictEqual(typeof context.dry_run, "string", "dry_run should remain string after update");
    assert.equal(context.dry_run, "false", "dry_run value should be preserved");
    assert.strictEqual(typeof context.output, "string", "new context values should also be strings");
  });

  it("all context fields are strings (Record<string, string>) including dry_run", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test context Record<string, string>",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);

    // Verify all fields are strings
    for (const [key, value] of Object.entries(context)) {
      assert.strictEqual(
        typeof value,
        "string",
        `context field '${key}' should be string, got ${typeof value}`
      );
    }

    // Specifically verify dry_run
    assert.strictEqual(typeof context.dry_run, "string", "dry_run specifically must be string");
    assert.strictEqual(typeof context.task, "string", "task field must be string");
  });
});

describe("US-006: Verify other context variables are preserved when dry_run is set", () => {
  const testRunIds: string[] = [];
  const workflowIds: string[] = [];

  afterEach(() => {
    for (const runId of testRunIds) {
      cleanupTestRun(runId);
    }
    testRunIds.length = 0;
  });

  it("when dry_run is set, the task context variable is still present", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflow(workflowId);

    const taskTitle = "Test task preservation with dry_run";
    const result = await runWorkflow({
      workflowId,
      taskTitle,
      dryRun: true,
    });
    testRunIds.push(result.id);

    // Query database to verify task is preserved
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    assert.ok("task" in context, "task should be in context when dry_run is set");
    assert.equal(context.task, taskTitle, "task value should match the provided title");
  });

  it("when dry_run is set, other workflow context variables are preserved", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    
    // Create workflow with custom context variables
    const customContext = {
      environment: "staging",
      region: "us-east-1",
      team: "platform",
    };
    createTestWorkflow(workflowId, customContext);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test context preservation",
      dryRun: true,
    });
    testRunIds.push(result.id);

    // Query database and verify all context variables are preserved
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);
    
    // Verify custom context is preserved
    assert.equal(context.environment, "staging", "environment context should be preserved");
    assert.equal(context.region, "us-east-1", "region context should be preserved");
    assert.equal(context.team, "platform", "team context should be preserved");
    
    // Verify dry_run was added
    assert.equal(context.dry_run, "true", "dry_run should be present");
    
    // Verify task was set
    assert.equal(context.task, "Test context preservation", "task should be present");
  });

  it("all context variables are accessible in database stored context", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    
    const customContext = {
      app_name: "api-service",
      version: "1.2.3",
      config_mode: "production",
    };
    createTestWorkflow(workflowId, customContext);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Database context access test",
      dryRun: false,
    });
    testRunIds.push(result.id);

    // Query database and verify context is accessible
    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    // Parse and verify context is valid JSON
    let context: Record<string, string>;
    try {
      context = JSON.parse(run.context);
    } catch (err) {
      assert.fail("context should be valid JSON");
    }

    // Verify all context variables are accessible
    assert.ok(Object.keys(context).includes("app_name"), "app_name should be in context");
    assert.ok(Object.keys(context).includes("version"), "version should be in context");
    assert.ok(Object.keys(context).includes("config_mode"), "config_mode should be in context");
    assert.ok(Object.keys(context).includes("task"), "task should be in context");
    assert.ok(Object.keys(context).includes("dry_run"), "dry_run should be in context");

    // Verify values are correct
    assert.equal(context.app_name, "api-service");
    assert.equal(context.version, "1.2.3");
    assert.equal(context.config_mode, "production");
    assert.equal(context.task, "Database context access test");
    assert.equal(context.dry_run, "false");
  });

  it("context preservation works with dry_run=true and multiple workflow variables", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    
    const customContext = {
      build_number: "12345",
      commit_sha: "abc123def456",
      branch: "main",
      deployment_target: "kubernetes",
    };
    createTestWorkflow(workflowId, customContext);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Complex context preservation",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);

    // All workflow context should be preserved
    assert.equal(context.build_number, "12345");
    assert.equal(context.commit_sha, "abc123def456");
    assert.equal(context.branch, "main");
    assert.equal(context.deployment_target, "kubernetes");
    
    // Standard fields should be present
    assert.equal(context.task, "Complex context preservation");
    assert.equal(context.dry_run, "true");
  });

  it("context variables are not overwritten when dry_run is added", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    
    const customContext = {
      database_url: "postgres://localhost",
      api_key: "secret-key-123",
    };
    createTestWorkflow(workflowId, customContext);

    // Create run without dry_run
    const result1 = await runWorkflow({
      workflowId,
      taskTitle: "First run",
    });
    testRunIds.push(result1.id);

    // Create run with dry_run
    const result2 = await runWorkflow({
      workflowId,
      taskTitle: "Second run",
      dryRun: true,
    });
    testRunIds.push(result2.id);

    const db = getDb();

    // Check first run
    const run1 = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result1.id) as { context: string };
    const context1 = JSON.parse(run1.context);

    // Check second run
    const run2 = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result2.id) as { context: string };
    const context2 = JSON.parse(run2.context);

    // Both should have workflow context preserved
    assert.equal(context1.database_url, "postgres://localhost");
    assert.equal(context1.api_key, "secret-key-123");
    assert.equal(context2.database_url, "postgres://localhost");
    assert.equal(context2.api_key, "secret-key-123");

    // Only difference should be the dry_run and task values
    assert.equal(context1.dry_run, "false");
    assert.equal(context2.dry_run, "true");
    assert.equal(context1.task, "First run");
    assert.equal(context2.task, "Second run");
  });

  it("all context fields are strings even with workflow-defined context", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    
    const customContext = {
      numeric_value: "42",
      boolean_string: "true",
      text_value: "example text",
    };
    createTestWorkflow(workflowId, customContext);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Type checking test",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);

    // All values should be strings
    for (const [key, value] of Object.entries(context)) {
      assert.strictEqual(
        typeof value,
        "string",
        `context field '${key}' should be string, got ${typeof value}`
      );
    }

    // Verify specific values
    assert.equal(context.numeric_value, "42");
    assert.equal(context.boolean_string, "true");
    assert.equal(context.text_value, "example text");
  });

  it("empty workflow context does not prevent dry_run and task from being set", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    
    // Create workflow without custom context
    createTestWorkflow(workflowId, {});

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Empty context test",
      dryRun: true,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);

    // Even with empty workflow context, dry_run and task should be present
    assert.equal(context.dry_run, "true", "dry_run should be set");
    assert.equal(context.task, "Empty context test", "task should be set");
  });

  it("order of context variables does not matter for preservation", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    
    const customContext = {
      z_field: "last",
      a_field: "first",
      m_field: "middle",
    };
    createTestWorkflow(workflowId, customContext);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Order test",
      dryRun: false,
    });
    testRunIds.push(result.id);

    const db = getDb();
    const run = db
      .prepare("SELECT context FROM runs WHERE id = ?")
      .get(result.id) as { context: string };

    const context = JSON.parse(run.context);

    // All context should be preserved regardless of order
    assert.ok("z_field" in context);
    assert.ok("a_field" in context);
    assert.ok("m_field" in context);
    assert.equal(context.z_field, "last");
    assert.equal(context.a_field, "first");
    assert.equal(context.m_field, "middle");
  });
});

describe("US-006: Unit test: Verify steps created with correct initial status", () => {
  const testRunIds: string[] = [];
  const workflowIds: string[] = [];

  afterEach(() => {
    for (const runId of testRunIds) {
      cleanupTestRun(runId);
    }
    testRunIds.length = 0;
  });

  it("creates correct number of steps when runWorkflow executes with multiple steps", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    const stepCount = 5;
    createTestWorkflowWithMultipleSteps(workflowId, stepCount);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test with multiple steps",
    });
    testRunIds.push(result.id);

    // Query the database to verify steps were created
    const db = getDb();
    const steps = db
      .prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY step_index ASC")
      .all(result.id) as Array<{ step_index: number }>;

    assert.equal(steps.length, stepCount, `should create ${stepCount} steps`);
  });

  it("verifies first step has status 'pending' when runWorkflow executes", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflowWithMultipleSteps(workflowId, 3);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test first step status",
    });
    testRunIds.push(result.id);

    const db = getDb();
    const firstStep = db
      .prepare("SELECT status FROM steps WHERE run_id = ? AND step_index = 0")
      .get(result.id) as { status: string };

    assert.equal(firstStep.status, "pending", "first step should have status 'pending'");
  });

  it("verifies subsequent steps have status 'waiting' when runWorkflow executes", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    createTestWorkflowWithMultipleSteps(workflowId, 4);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test subsequent steps status",
    });
    testRunIds.push(result.id);

    const db = getDb();
    const subsequentSteps = db
      .prepare("SELECT status, step_index FROM steps WHERE run_id = ? AND step_index > 0 ORDER BY step_index ASC")
      .all(result.id) as Array<{ status: string; step_index: number }>;

    for (const step of subsequentSteps) {
      assert.equal(step.status, "waiting", `step at index ${step.step_index} should have status 'waiting'`);
    }
  });

  it("verifies step_index fields are sequential when runWorkflow creates steps", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    const stepCount = 6;
    createTestWorkflowWithMultipleSteps(workflowId, stepCount);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test sequential step indices",
    });
    testRunIds.push(result.id);

    const db = getDb();
    const steps = db
      .prepare("SELECT step_index FROM steps WHERE run_id = ? ORDER BY step_index ASC")
      .all(result.id) as Array<{ step_index: number }>;

    for (let i = 0; i < steps.length; i++) {
      assert.equal(steps[i].step_index, i, `step at position ${i} should have step_index=${i}`);
    }
  });

  it("verifies all steps created correctly with mixed status values", async () => {
    const workflowId = `test-workflow-${crypto.randomUUID()}`;
    workflowIds.push(workflowId);
    const stepCount = 3;
    createTestWorkflowWithMultipleSteps(workflowId, stepCount);

    const result = await runWorkflow({
      workflowId,
      taskTitle: "Test all steps structure",
    });
    testRunIds.push(result.id);

    const db = getDb();
    const steps = db
      .prepare("SELECT id, run_id, step_index, status FROM steps WHERE run_id = ? ORDER BY step_index ASC")
      .all(result.id) as Array<{ id: string; run_id: string; step_index: number; status: string }>;

    // Verify correct count
    assert.equal(steps.length, stepCount, `should have ${stepCount} steps`);

    // Verify status progression
    assert.equal(steps[0].status, "pending", "first step should be pending");
    for (let i = 1; i < steps.length; i++) {
      assert.equal(steps[i].status, "waiting", `step ${i} should be waiting`);
    }

    // Verify all steps belong to correct run
    for (const step of steps) {
      assert.equal(step.run_id, result.id, "all steps should belong to the created run");
    }

    // Verify step IDs are unique
    const stepIds = steps.map(s => s.id);
    const uniqueIds = new Set(stepIds);
    assert.equal(uniqueIds.size, steps.length, "all step IDs should be unique");
  });
});
