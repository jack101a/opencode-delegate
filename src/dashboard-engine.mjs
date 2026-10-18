const HOUR_MS = 60 * 60 * 1000;
const CHARS_PER_TOKEN = 4;

/**
 * Compute aggregate summary statistics for a list of request records.
 *
 * @param {Array<{tokens?: number, latencyMs?: number, status?: string}>} records
 * @returns {{totalRequests: number, totalTokens: number, avgLatencyMs: number, successRatePercent: number}}
 */
export function computeSummaryStats(records) {
  const list = Array.isArray(records) ? records : [];
  const totalRequests = list.length;

  if (totalRequests === 0) {
    return {
      totalRequests: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      successRatePercent: 100
    };
  }

  let totalTokens = 0;
  let totalLatency = 0;
  let successCount = 0;

  for (const record of list) {
    totalTokens += Number(record?.tokens) || 0;
    totalLatency += Number(record?.latencyMs) || 0;
    if (record?.status === "PASS") {
      successCount += 1;
    }
  }

  return {
    totalRequests,
    totalTokens,
    avgLatencyMs: Math.round(totalLatency / totalRequests),
    successRatePercent: Math.round((successCount / totalRequests) * 100)
  };
}

/**
 * Filter request records by an optional keyword, status, and model.
 * All provided criteria are combined with AND semantics.
 *
 * @param {Array<object>} records
 * @param {{search?: string, status?: string, model?: string}} [criteria]
 * @returns {Array<object>}
 */
export function filterRecords(records, criteria = {}) {
  const list = Array.isArray(records) ? records : [];
  const { search, status, model } = criteria ?? {};
  const keyword = typeof search === "string" ? search.trim().toLowerCase() : "";

  return list.filter((record) => {
    if (keyword) {
      const task = typeof record?.task === "string" ? record.task.toLowerCase() : "";
      if (!task.includes(keyword)) {
        return false;
      }
    }
    if (status && record?.status !== status) {
      return false;
    }
    if (model && record?.model !== model) {
      return false;
    }
    return true;
  });
}

/**
 * Estimate the number of tokens in a string using a simple
 * characters-per-token heuristic (rounded up).
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (typeof text !== "string" || text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Generate hourly bucketed trend data over the trailing `hours` window.
 * The returned array is ordered chronologically (oldest bucket first).
 *
 * @param {Array<{timestamp?: number, tokens?: number}>} records
 * @param {number} [hours]
 * @returns {Array<{timestamp: number, bucketStartMs: number, tokens: number, requests: number}>}
 */
export function generateTrendData(records, hours = 24) {
  const list = Array.isArray(records) ? records : [];
  const bucketCount = Number.isInteger(hours) && hours > 0 ? hours : 24;
  const now = Date.now();

  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStartMs = now - (bucketCount - index) * HOUR_MS;
    return { timestamp: bucketStartMs, bucketStartMs, tokens: 0, requests: 0 };
  });

  for (const record of list) {
    const ts = Number(record?.timestamp);
    if (!Number.isFinite(ts)) {
      continue;
    }
    const ageMs = now - ts;
    if (ageMs < 0 || ageMs >= bucketCount * HOUR_MS) {
      continue;
    }
    const ageHours = Math.floor(ageMs / HOUR_MS);
    const index = bucketCount - 1 - ageHours;
    if (index < 0 || index >= bucketCount) {
      continue;
    }
    buckets[index].tokens += Number(record?.tokens) || 0;
    buckets[index].requests += 1;
  }

  return buckets;
}
