import Exa from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY);

// Freshness defaults per category (in hours)
const freshnessDefaults = {
  tweet: 48,              // 2 days
  research_paper: 4320,   // 180 days (6 months)
  default: 336            // 2 weeks for general queries
};

// Categories that use dedicated indices and don't support startPublishedDate
const noDateFilterCategories = new Set(["company", "people"]);

/**
 * Calculate startPublishedDate from max_age_hours
 */
function getStartDate(maxAgeHours) {
  const date = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  return date.toISOString();
}

/**
 * Search the web via Exa
 */
export async function searchExa(query, category, maxAgeOverride, numResults = 5) {
  const searchParams = {
    numResults: Math.min(50, Math.max(3, numResults)),
    highlights: {
      numSentences: 3,
      highlightsPerUrl: 5,
    },
    type: "auto",
  };

  if (category) {
    searchParams.category = category;
  }

  // Some categories (company, people) don't support date filters
  if (!category || !noDateFilterCategories.has(category)) {
    const defaultMaxAge = category ? (freshnessDefaults[category] || freshnessDefaults.default) : freshnessDefaults.default;
    const maxAgeHours = maxAgeOverride && maxAgeOverride < defaultMaxAge ? maxAgeOverride : defaultMaxAge;
    searchParams.startPublishedDate = getStartDate(maxAgeHours);
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

async function rateLimitedSearch(query, category, maxAgeOverride, numResults) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
  return searchExa(query, category, maxAgeOverride, numResults);
}

/**
 * Run multiple searches in parallel for faster results
 */
export async function searchMultiple(searches) {
  const searchPromises = searches.map(async ({ query, category, maxAgeOverride, numResults = 5 }) => {
    const startTime = Date.now();
    try {
      const results = await searchExa(query, category, maxAgeOverride, numResults);
      const timeMs = Date.now() - startTime;
      return { query, category, results, timeMs };
    } catch (err) {
      const timeMs = Date.now() - startTime;
      return { query, category, results: [], timeMs, error: err.message };
    }
  });

  return Promise.all(searchPromises);
}
