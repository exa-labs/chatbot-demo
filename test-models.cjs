const http = require('http');

const MODELS = {
  gemini: "google/gemini-2.5-flash",
  openai: "openai/gpt-4o",
  qwen: "qwen/qwen-2.5-72b-instruct"
};

// Varied test queries - mix of search-requiring and knowledge-based
const QUERIES = [
  // Current events / News (require search)
  "What's the latest news about AI regulation?",
  "What are the current stock prices of NVIDIA?",
  "Who won the most recent Grammy awards?",

  // Product/Company info (require search)
  "What is Exa AI and what does it do?",
  "What's the current price of the iPhone 16?",
  "What are the newest features in GPT-5?",

  // General knowledge (shouldn't need search)
  "Explain how neural networks work",
  "What is the capital of France?",
  "Write a Python function to reverse a string",

  // Complex/hybrid queries
  "Compare the specs of PS5 vs Xbox Series X in 2024",
];

async function testQuery(query, model, testNum) {
  const startTime = Date.now();
  let firstChunkTime = null;
  let fullResponse = '';
  let searchUsed = false;
  let sources = [];

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      message: query,
      history: [],
      model: model,
      exaEnabled: true
    });

    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/chat/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        if (!firstChunkTime) {
          firstChunkTime = Date.now();
        }

        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content') {
                fullResponse += data.content || '';
              } else if (data.type === 'search_complete') {
                searchUsed = true;
                sources = data.sources || [];
              }
            } catch (e) {
              // Not JSON, skip
            }
          }
        }
      });

      res.on('end', () => {
        const endTime = Date.now();
        resolve({
          testNum,
          model: Object.keys(MODELS).find(k => MODELS[k] === model),
          query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
          totalLatency: endTime - startTime,
          timeToFirstChunk: firstChunkTime ? firstChunkTime - startTime : null,
          responseLength: fullResponse.length,
          searchUsed,
          sourceCount: sources.length,
          success: fullResponse.length > 0
        });
      });
    });

    req.on('error', (e) => {
      resolve({
        testNum,
        model: Object.keys(MODELS).find(k => MODELS[k] === model),
        query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
        totalLatency: Date.now() - startTime,
        timeToFirstChunk: null,
        responseLength: 0,
        searchUsed: false,
        sourceCount: 0,
        success: false,
        error: e.message
      });
    });

    req.setTimeout(120000); // 2 minute timeout
    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('Starting model performance tests...\n');
  console.log('=' .repeat(100));

  const results = {
    gemini: [],
    openai: [],
    qwen: []
  };

  // Test each model with 10 queries
  for (const [modelName, modelId] of Object.entries(MODELS)) {
    console.log(`\nTesting ${modelName.toUpperCase()} (${modelId})...`);
    console.log('-'.repeat(80));

    for (let i = 0; i < 10; i++) {
      const query = QUERIES[i % QUERIES.length];
      console.log(`  Test ${i + 1}/10: "${query.substring(0, 40)}..."`);

      const result = await testQuery(query, modelId, i + 1);
      results[modelName].push(result);

      const status = result.success ? '✓' : '✗';
      const search = result.searchUsed ? `[SEARCH: ${result.sourceCount} sources]` : '[NO SEARCH]';
      console.log(`    ${status} Total: ${result.totalLatency}ms | TTFC: ${result.timeToFirstChunk}ms | Resp: ${result.responseLength} chars ${search}`);

      // Small delay between requests
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));

  for (const [modelName, modelResults] of Object.entries(results)) {
    const successful = modelResults.filter(r => r.success);
    const avgLatency = successful.length > 0
      ? Math.round(successful.reduce((a, b) => a + b.totalLatency, 0) / successful.length)
      : 'N/A';
    const avgTTFC = successful.filter(r => r.timeToFirstChunk).length > 0
      ? Math.round(successful.filter(r => r.timeToFirstChunk).reduce((a, b) => a + b.timeToFirstChunk, 0) / successful.filter(r => r.timeToFirstChunk).length)
      : 'N/A';
    const avgResponseLen = successful.length > 0
      ? Math.round(successful.reduce((a, b) => a + b.responseLength, 0) / successful.length)
      : 'N/A';
    const searchCount = successful.filter(r => r.searchUsed).length;

    console.log(`\n${modelName.toUpperCase()}:`);
    console.log(`  Success Rate: ${successful.length}/10`);
    console.log(`  Avg Total Latency: ${avgLatency}ms`);
    console.log(`  Avg Time to First Chunk: ${avgTTFC}ms`);
    console.log(`  Avg Response Length: ${avgResponseLen} chars`);
    console.log(`  Searches Triggered: ${searchCount}/10`);

    // Min/Max latency
    if (successful.length > 0) {
      const latencies = successful.map(r => r.totalLatency);
      console.log(`  Latency Range: ${Math.min(...latencies)}ms - ${Math.max(...latencies)}ms`);
    }
  }

  // Detailed results table
  console.log('\n' + '='.repeat(100));
  console.log('DETAILED RESULTS');
  console.log('='.repeat(100));
  console.log('\nModel     | Test | Query                                    | Latency | TTFC   | Len  | Search');
  console.log('-'.repeat(100));

  for (const [modelName, modelResults] of Object.entries(results)) {
    for (const r of modelResults) {
      const search = r.searchUsed ? `Yes(${r.sourceCount})` : 'No';
      console.log(`${modelName.padEnd(9)} | ${String(r.testNum).padStart(4)} | ${r.query.padEnd(40)} | ${String(r.totalLatency).padStart(7)}ms | ${String(r.timeToFirstChunk || 'N/A').padStart(6)}ms | ${String(r.responseLength).padStart(4)} | ${search}`);
    }
  }
}

runTests().catch(console.error);
