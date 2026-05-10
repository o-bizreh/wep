/** CISA Known Exploited Vulnerabilities catalog client.
 *  The catalog is a public JSON feed updated daily.
 *  We cache it in-process for 1 hour to avoid hammering the endpoint on every scan. */

interface KevEntry {
  cveID: string;
}

interface KevCatalog {
  vulnerabilities: KevEntry[];
}

let kevCache: Set<string> | null = null;
let kevCacheAt = 0;
const KEV_TTL_MS = 60 * 60 * 1_000; // 1 hour
const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

export async function getExploitedCveIds(): Promise<Set<string>> {
  if (kevCache && Date.now() - kevCacheAt < KEV_TTL_MS) {
    return kevCache;
  }

  try {
    const response = await fetch(KEV_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`KEV fetch failed: ${response.status}`);
    const catalog = (await response.json()) as KevCatalog;
    kevCache = new Set(catalog.vulnerabilities.map((v) => v.cveID));
    kevCacheAt = Date.now();
    return kevCache;
  } catch (e) {
    console.warn('[kev-client] Failed to fetch KEV catalog, using empty set:', (e as Error).message);
    return new Set();
  }
}
