import { runCiCostScan, getCiCostScanStatus, CiCostRepository } from '@wep/ci-cost';
import { createDynamoDBClient, getTableName } from '@wep/aws-clients';

async function waitForScan(
  getStatus: () => { status: string } | null,
  timeoutMs = 20 * 60 * 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = getStatus();
    if (s?.status === 'done') return;
    if (s?.status === 'failed') throw new Error(`Scan failed: ${(s as { status: string; error?: string }).error ?? 'unknown'}`);
    await new Promise<void>((r) => setTimeout(r, 2000));
  }
  throw new Error('Scan timed out');
}

export async function ciCostJob(): Promise<void> {
  const client = createDynamoDBClient();
  const repo = new CiCostRepository(client, getTableName('ci-cost'));
  const org = process.env['GITHUB_ORG'] ?? 'washmen';
  const githubToken = process.env['GITHUB_TOKEN'] ?? '';

  await runCiCostScan(org, repo, githubToken);
  await waitForScan(getCiCostScanStatus);
}
