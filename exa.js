import Exa from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY);

/**
 * Search the web via Exa
 */
export async function searchExa(query, category, numResults = 5) {
  const searchParams = {
    numResults: Math.min(50, Math.max(3, numResults)),
    highlights: {
      maxCharacters: 4000,
    },
    type: "auto",
  };

  if (category) {
    searchParams.category = category;
  }

  const response = await exa.searchAndContents(query, searchParams);

  if (!response.results || response.results.length === 0) {
    return [];
  }

  return response.results.map((r) => ({
    title: r.title,
    url: r.url,
    text: (r.highlights || []).join("\n").slice(0, 4000),
    publishedDate: r.publishedDate,
    author: r.author,
  }));
}

// Rate limiter - max 4 requests per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 250;

async function rateLimitedSearch(query, category, numResults) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
  return searchExa(query, category, numResults);
}

/**
 * Run multiple searches in parallel for faster results
 */
export async function searchMultiple(searches) {
  const searchPromises = searches.map(async ({ query, category, numResults = 5 }) => {
    const startTime = Date.now();
    try {
      const results = await searchExa(query, category, numResults);
      const timeMs = Date.now() - startTime;
      return { query, category, results, timeMs };
    } catch (err) {
      const timeMs = Date.now() - startTime;
      return { query, category, results: [], timeMs, error: err.message };
    }
  });

  return Promise.all(searchPromises);
}
