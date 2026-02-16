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

describe("US-005: dry_run is a string (not boolean) for template compatibility", () => {
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
