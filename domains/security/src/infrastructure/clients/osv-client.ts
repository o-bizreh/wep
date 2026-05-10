import type { CveEntry, CveSeverity } from '../../domain/entities/vuln-package.js';

interface OsvVulnerability {
  id: string;
  aliases?: string[];
  summary?: string;
  published: string;
  modified: string;
  severity?: Array<{ type: string; score: string }>;
  database_specific?: { severity?: string };
  references?: Array<{ type: string; url: string }>;
}

interface OsvQueryResponse {
  vulns?: OsvVulnerability[];
}

function parseSeverity(vuln: OsvVulnerability): CveSeverity {
  const label = vuln.database_specific?.severity?.toUpperCase();
  if (label === 'CRITICAL') return 'CRITICAL';
  if (label === 'HIGH') return 'HIGH';
  if (label === 'MEDIUM' || label === 'MODERATE') return 'MEDIUM';
  if (label === 'LOW') return 'LOW';
  return 'UNKNOWN';
}

function parseCvssScore(vuln: OsvVulnerability): number | null {
  const cvssEntry = vuln.severity?.find((s) => s.type === 'CVSS_V3' || s.type === 'CVSS_V2');
  if (!cvssEntry) return null;
  // CVSS vector string — extract base score from AV: ... notation isn't trivial, so just return null
  // OSV sometimes puts a numeric score directly
  const numeric = parseFloat(cvssEntry.score);
  return isNaN(numeric) ? null : numeric;
}

export async function queryOsvVulnerabilities(
  packageName: string,
  ecosystem: string,
): Promise<CveEntry[]> {
  const normalizedEcosystem = ecosystem === 'npm' ? 'npm' : ecosystem;

  const response = await fetch('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      package: { name: packageName, ecosystem: normalizedEcosystem },
    }),
  });

  if (!response.ok) {
    throw new Error(`OSV API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OsvQueryResponse;
  const vulns = data.vulns ?? [];

  return vulns.map((vuln): CveEntry => {
    const cveAlias = vuln.aliases?.find((a) => a.startsWith('CVE-')) ?? vuln.id;
    const refUrl = vuln.references?.find((r) => r.type === 'WEB' || r.type === 'ADVISORY')?.url ?? '';
    return {
      cveId: cveAlias,
      aliases: vuln.aliases ?? [],
      summary: vuln.summary ?? 'No description available.',
      severity: parseSeverity(vuln),
      cvssScore: parseCvssScore(vuln),
      publishedAt: vuln.published,
      modifiedAt: vuln.modified,
      isKevExploited: false, // enriched separately
      osvId: vuln.id,
      referenceUrl: refUrl,
    };
  });
}
