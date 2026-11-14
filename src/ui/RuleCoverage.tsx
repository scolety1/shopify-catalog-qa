import { auditRules, type AuditResult } from "../audit";

export function RuleCoverage({ audit }: { audit: AuditResult }) {
  const findingCounts = new Map<string, number>();
  for (const finding of audit.findings) {
    findingCounts.set(finding.ruleId, (findingCounts.get(finding.ruleId) ?? 0) + 1);
  }
  const skippedReasons = new Map(audit.rulesSkipped.map((rule) => [rule.id, rule.reason]));
  const unregisteredSkippedRules = audit.rulesSkipped.filter((skipped) =>
    !auditRules.some((rule) => rule.id === skipped.id));

  return (
    <section className="rule-coverage" aria-label="Rule coverage">
      <div className="rule-coverage-heading">
        <div>
          <p className="eyebrow">Audit coverage</p>
          <h2>What this run checked</h2>
        </div>
        <span>{auditRules.length} registered rules</span>
      </div>
      <p className="coverage-caveat">
        Rule execution confirms that a rule was evaluated against the catalog. It is not proof that the rule applied to every entity; each rule abstains when its required facts are absent.
      </p>
      <div className="rule-coverage-list">
        {auditRules.map((rule) => {
          const skippedReason = skippedReasons.get(rule.id);
          const executed = audit.rulesExecuted.includes(rule.id);
          const count = findingCounts.get(rule.id) ?? 0;
          return (
            <article className="rule-coverage-row" key={rule.id}>
              <div className="rule-coverage-title">
                <div>
                  <code>{rule.id}</code>
                  <h3>{rule.title}</h3>
                </div>
                <span className={`rule-run-state ${skippedReason || !executed ? "rule-run-state--skipped" : ""}`}>
                  {skippedReason ? "Skipped" : executed ? "Executed" : "Not executed"}
                </span>
                <strong aria-label={`${count} findings this run`}>{count}<small> findings</small></strong>
              </div>
              <dl>
                <div><dt>Scope</dt><dd>{rule.applicability.scope}</dd></div>
                <div><dt>Applies when</dt><dd>{rule.applicability.appliesWhen}</dd></div>
                <div><dt>Abstains when</dt><dd>{rule.applicability.abstainsWhen}</dd></div>
                {skippedReason ? <div className="rule-skip-reason"><dt>Skipped reason</dt><dd>{skippedReason}</dd></div> : null}
              </dl>
            </article>
          );
        })}
      </div>
      {unregisteredSkippedRules.length > 0 ? (
        <div className="future-skipped-rules" role="status">
          <strong>Additional skipped rules reported by this run</strong>
          <ul>{unregisteredSkippedRules.map((rule) => <li key={rule.id}><code>{rule.id}</code><span>{rule.reason}</span></li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
