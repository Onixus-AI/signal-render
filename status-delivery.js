// Retries only transport failures and retryable HTTP responses; validation/auth
// rejections stop immediately. The same attempt token travels on every delivery.
export async function deliverRenderStatus(endpoint, token, payload, {
  fetcher = fetch, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), maxAttempts = 4,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetcher(endpoint, {method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if (response.ok) return {ok:true,attempts:attempt};
      const detail = (await response.text().catch(()=>'' )).slice(0,200);
      lastError = `HTTP ${response.status}: ${detail}`;
      if (response.status !== 408 && response.status !== 429 && response.status < 500) {
        return {ok:false,attempts:attempt,error:lastError};
      }
    } catch(error) { lastError = String(error?.message ?? error).slice(0,200); }
    if (attempt < maxAttempts) await sleep(Math.min(5000, 500 * 2 ** (attempt-1)));
  }
  return {ok:false,attempts:maxAttempts,error:lastError};
}
