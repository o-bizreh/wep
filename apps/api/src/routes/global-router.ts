import { Router, type Request, type Response } from 'express';
import { problemDetails } from '@wep/domain-types';
import {
  ACMClient, ListCertificatesCommand, DescribeCertificateCommand,
  CloudFrontClient, ListDistributionsCommand,
  Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand,
  WAFV2Client, ListWebACLsCommand, ListResourcesForWebACLCommand,
  regionStore,
  credentialStore,
} from '@wep/aws-clients';

const regionProvider      = regionStore.getProvider();
const credentialsProvider = credentialStore.getProvider();

const acmClient   = new ACMClient({ region: 'us-east-1', credentials: credentialsProvider }); // ACM for CF must be us-east-1
const cfClient    = new CloudFrontClient({ region: 'us-east-1', credentials: credentialsProvider });
const r53Client   = new Route53Client({ region: 'us-east-1', credentials: credentialsProvider });
const wafClient   = new WAFV2Client({ region: 'us-east-1', credentials: credentialsProvider }); // CloudFront WAF is GLOBAL scope
// Regional WAF for ALB/API GW uses the stack region
const wafRegionalClient = new WAFV2Client({ region: regionProvider, credentials: credentialsProvider });

function err500(res: Response, msg: string) {
  res.status(500).json(problemDetails(500, 'Internal error', msg));
}

export function createGlobalRouter(): Router {
  const router = Router();

  // GET /global/distributions
  router.get('/distributions', async (_req: Request, res: Response) => {
    try {
      const all: unknown[] = [];
      let marker: string | undefined;
      do {
        const r = await cfClient.send(new ListDistributionsCommand({ Marker: marker }));
        const list = r.DistributionList;
        for (const d of list?.Items ?? []) {
          all.push({
            id: d.Id ?? '',
            domainName: d.DomainName ?? '',
            aliases: d.Aliases?.Items ?? [],
            status: d.Status ?? '',
            enabled: d.Enabled ?? false,
            priceClass: d.PriceClass ?? '',
            origins: (d.Origins?.Items ?? []).map((o) => ({ id: o.Id, domain: o.DomainName })),
            defaultCacheBehavior: d.DefaultCacheBehavior?.ViewerProtocolPolicy ?? '',
            httpVersion: d.HttpVersion ?? '',
            wafWebAclId: d.WebACLId || null,
            lastModified: d.LastModifiedTime?.toISOString() ?? null,
          });
        }
        marker = list?.NextMarker;
      } while (marker);
      res.json(all);
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // GET /global/dns
  router.get('/dns', async (req: Request, res: Response) => {
    try {
      const zoneId = req.query['zoneId'] as string | undefined;

      // List zones
      const zones: unknown[] = [];
      let nextToken: string | undefined;
      do {
        const r = await r53Client.send(new ListHostedZonesCommand({ Marker: nextToken }));
        for (const z of r.HostedZones ?? []) {
          zones.push({ id: z.Id ?? '', name: z.Name ?? '', private: z.Config?.PrivateZone ?? false, recordCount: z.ResourceRecordSetCount ?? 0 });
        }
        nextToken = r.NextMarker;
      } while (nextToken);

      // If zoneId provided, return records for that zone
      if (zoneId) {
        const records: unknown[] = [];
        let rrToken: string | undefined;
        do {
          const r = await r53Client.send(new ListResourceRecordSetsCommand({ HostedZoneId: zoneId, StartRecordIdentifier: rrToken }));
          for (const rr of r.ResourceRecordSets ?? []) {
            records.push({
              name: rr.Name ?? '',
              type: rr.Type ?? '',
              ttl: rr.TTL ?? null,
              values: rr.ResourceRecords?.map((v) => v.Value) ?? [],
              alias: rr.AliasTarget ? { dnsName: rr.AliasTarget.DNSName, evaluateHealth: rr.AliasTarget.EvaluateTargetHealth } : null,
            });
          }
          rrToken = r.NextRecordIdentifier;
        } while (rrToken);
        res.json({ zones, records });
        return;
      }

      res.json({ zones, records: [] });
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // GET /global/certificates
  router.get('/certificates', async (_req: Request, res: Response) => {
    try {
      const arns: string[] = [];
      let nextToken: string | undefined;
      do {
        const r = await acmClient.send(new ListCertificatesCommand({ NextToken: nextToken, MaxItems: 100 }));
        arns.push(...(r.CertificateSummaryList ?? []).map((c) => c.CertificateArn ?? '').filter(Boolean));
        nextToken = r.NextToken;
      } while (nextToken);

      const certs = await Promise.all(arns.map(async (arn) => {
        const d = await acmClient.send(new DescribeCertificateCommand({ CertificateArn: arn }));
        const c = d.Certificate;
        if (!c) return null;
        const expiresAt = c.NotAfter?.toISOString() ?? null;
        const daysLeft  = expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000) : null;
        return {
          arn,
          domain: c.DomainName ?? '',
          sans: c.SubjectAlternativeNames ?? [],
          status: c.Status ?? '',
          type: c.Type ?? '',
          keyAlgorithm: c.KeyAlgorithm ?? '',
          expiresAt,
          daysLeft,
          inUseBy: c.InUseBy ?? [],
        };
      }));

      res.json(certs.filter(Boolean));
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // GET /global/waf
  router.get('/waf', async (_req: Request, res: Response) => {
    try {
      const fetchAcls = async (client: WAFV2Client, scope: 'CLOUDFRONT' | 'REGIONAL') => {
        const acls: unknown[] = [];
        let nextToken: string | undefined;
        do {
          const r = await client.send(new ListWebACLsCommand({ Scope: scope, NextMarker: nextToken, Limit: 100 }));
          for (const acl of r.WebACLs ?? []) {
            let resources: string[] = [];
            try {
              const rr = await client.send(new ListResourcesForWebACLCommand({ WebACLArn: acl.ARN ?? '' }));
              resources = rr.ResourceArns ?? [];
            } catch { /* skip if no permission */ }
            acls.push({
              id: acl.Id ?? '',
              name: acl.Name ?? '',
              arn: acl.ARN ?? '',
              scope,
              description: acl.Description ?? '',
              ruleCount: 0,
              resources,
              lockToken: acl.LockToken ?? '',
            });
          }
          nextToken = r.NextMarker;
        } while (nextToken);
        return acls;
      };

      const [global, regional] = await Promise.all([
        fetchAcls(wafClient, 'CLOUDFRONT').catch(() => []),
        fetchAcls(wafRegionalClient, 'REGIONAL').catch(() => []),
      ]);

      res.json([...global, ...regional]);
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  return router;
}
