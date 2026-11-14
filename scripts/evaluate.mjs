import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

function argument(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const label = argument("--label", "mission-4-final");
const output = resolve(argument("--output", "evaluation/adversarial-final.json"));
const enforceGates = !process.argv.includes("--no-gate");
const server = await createServer({ appType: "custom", server: { middlewareMode: true }, logLevel: "error" });
try {
  const { evaluateAdversarialCorpus, formatEvaluationSummary } = await server.ssrLoadModule("/evaluation/runner.ts");
  const report = evaluateAdversarialCorpus(label);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${formatEvaluationSummary(report)}\nMachine report: ${output}\n`);
  if (enforceGates && !report.gates.passed) process.exitCode = 1;
} finally { await server.close(); }
