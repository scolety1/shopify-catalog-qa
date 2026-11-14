import type { AuditResult } from "../audit";
import type { Catalog } from "../catalog";

interface AuditSummaryProps {
  catalog: Catalog;
  audit: AuditResult;
}

export function AuditSummary({ catalog, audit }: AuditSummaryProps) {
  const variantCount = catalog.products.reduce((total, product) => total + product.variants.length, 0);
  const counts = audit.findings.reduce(
    (result, finding) => ({ ...result, [finding.severity]: result[finding.severity] + 1 }),
    { high: 0, medium: 0, low: 0 },
  );

  return (
    <section className="summary-grid" aria-label="Audit summary">
      <article className="summary-card summary-card--catalog">
        <span className="summary-label">Catalog scope</span>
        <strong>{catalog.products.length}</strong>
        <span>{variantCount} variants</span>
      </article>
      <article className="summary-card summary-card--total">
        <span className="summary-label">Findings</span>
        <strong>{audit.findings.length}</strong>
        <span>{audit.rulesExecuted.length} rules executed</span>
      </article>
      <article className="summary-card summary-card--high">
        <span className="summary-label"><i className="severity-dot severity-dot--high" />High</span>
        <strong>{counts.high}</strong>
        <span>Address first</span>
      </article>
      <article className="summary-card summary-card--medium">
        <span className="summary-label"><i className="severity-dot severity-dot--medium" />Medium</span>
        <strong>{counts.medium}</strong>
        <span>Operational cleanup</span>
      </article>
      <article className="summary-card summary-card--low">
        <span className="summary-label"><i className="severity-dot severity-dot--low" />Low</span>
        <strong>{counts.low}</strong>
        <span>Plan before launch</span>
      </article>
    </section>
  );
}
