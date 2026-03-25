import Exa from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY);

// BlueJ's domains split across 3 batches for parallel discovery.
// In production they cover ~2000+ domains. includeDomains supports
// up to 1200 per call, so 3 calls covers everything.
const DOMAIN_BATCHES = [
  [
    "irs.gov", "treasury.gov", "congress.gov", "supremecourt.gov",
    "uscourts.gov", "govinfo.gov", "federalregister.gov",
    "taxnotes.com", "tax.gov", "ttb.gov",
  ],
  [
    "ftb.ca.gov", "cdtfa.ca.gov", "tax.ny.gov", "revenue.pa.gov",
    "tax.illinois.gov", "comptroller.texas.gov", "dor.wa.gov",
    "law.cornell.edu", "justia.com", "findlaw.com",
  ],
  [
    "taxfoundation.org", "aicpa-cima.com", "americanbar.org",
    "bdo.com", "pwc.com", "deloitte.com", "ey.com", "kpmg.com",
    "bloomberglaw.com", "thomsonreuters.com",
  ],
];

const MAX_AGE_HOURS = 336;                // 2 weeks
const DISCOVERY_LIVECRAWL_TIMEOUT = 1500; // 1.5s opportunistic
const REFRESH_LIVECRAWL_TIMEOUT = 10000;  // 10s targeted

/**
 * Step 1: Discovery — 3x parallel /search calls across domain batches.
 * maxAgeHours prefers cached content within 2 weeks. Short livecrawlTimeout
 * catches easy livecrawls without blocking. Returns crawlDate per result.
 */
export async function discoverySearch(query, numResults = 10) {
  const startTime = Date.now();

  const batchPromises = DOMAIN_BATCHES.map(async (domains) => {
    try {
      const response = await exa.searchAndContents(query, {
        numResults,
        includeDomains: domains,
        maxAgeHours: MAX_AGE_HOURS,
        livecrawlTimeout: DISCOVERY_LIVECRAWL_TIMEOUT,
        text: true,
        highlights: { maxCharacters: 4000 },
      });
      return response.results || [];
    } catch (err) {
      console.error(`Discovery batch failed: ${err.message}`);
      return [];
    }
  });

  const batchResults = await Promise.all(batchPromises);
  const allResults = batchResults.flat();
  const timeMs = Date.now() - startTime;

  return {
    results: allResults.map((r) => ({
      title: r.title,
      url: r.url,
      text: r.text?.slice(0, 4000) || (r.highlights || []).join("\n").slice(0, 4000),
      publishedDate: r.publishedDate,
      author: r.author,
      crawlDate: r.crawlDate,
    })),
    timeMs,
  };
}

/**
 * Step 3: Targeted re-fetch — /contents for URLs the agent identified
 * as both relevant AND stale. Full livecrawl timeout.
 */
export async function fetchFreshContents(urls) {
  const startTime = Date.now();

  try {
    const response = await exa.getContents(urls, {
      livecrawl: "always",
      livecrawlTimeout: REFRESH_LIVECRAWL_TIMEOUT,
      text: true,
    });

    return {
      results: (response.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        text: r.text?.slice(0, 4000),
        crawlDate: r.crawlDate,
      })),
      timeMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error(`Fresh contents fetch failed: ${err.message}`);
    return { results: [], timeMs: Date.now() - startTime };
  }
}

export { DOMAIN_BATCHES, MAX_AGE_HOURS, DISCOVERY_LIVECRAWL_TIMEOUT, REFRESH_LIVECRAWL_TIMEOUT };
