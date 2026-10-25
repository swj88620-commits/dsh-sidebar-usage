/**
 * Host half of the Usage & Balance plugin.
 *
 * The browser asks this Host route for a cached, derived view of the Session
 * logs. DSH remains the source of truth: this plugin only folds committed
 * `assistant/message` usage records into per-Session and per-day totals.
 */

const ROUTE = '/dsh-usage/api';
const PENDING_LIMIT = 400;
const CORPUS_REFRESH_MS = 30_000;

/**
 * DeepSeek list prices in CNY per one million tokens.
 *
 * Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * Peak hours are Beijing time, Monday to Friday, 09:00-12:00 and
 * 14:00-18:00. Statutory holidays are not modelled here, so the value is a
 * close estimate rather than billing-grade accounting.
 */
const PRICES = {
  flash: {
    peak: { cacheRead: 0.04, input: 2, output: 8 },
    offPeak: { cacheRead: 0.02, input: 1, output: 4 },
  },
  pro: {
    peak: { cacheRead: 0.3, input: 9, output: 27 },
    offPeak: { cacheRead: 0.15, input: 4.5, output: 13.5 },
  },
};

function asCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function asTime(value) {
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

function roundCost(value) {
  return Math.round(value * 1e6) / 1e6;
}

function localDayKey(time) {
  const date = new Date(asTime(time));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isBeijingPeak(time) {
  // Beijing time has a fixed UTC+8 offset and no daylight saving.
  const date = new Date(asTime(time) + 8 * 60 * 60 * 1000);
  const weekday = date.getUTCDay();
  if (weekday < 1 || weekday > 5) return false;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (minutes >= 9 * 60 && minutes < 12 * 60)
    || (minutes >= 14 * 60 && minutes < 18 * 60);
}

function ratesFor(provider, model, time) {
  const identity = `${provider ?? ''} ${model ?? ''}`.toLowerCase();
  if (!identity.includes('deepseek')) return null;
  let family;
  if (identity.includes('pro')) family = 'pro';
  else if (identity.includes('flash')
    || identity.includes('deepseek-chat')
    || identity.includes('deepseek-reasoner')
    || identity.includes('deepseek-v4')) family = 'flash';
  else return null;
  return isBeijingPeak(time) ? PRICES[family].peak : PRICES[family].offPeak;
}

function emptyStats() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    cost: 0,
    costKnown: true,
    days: Object.create(null),
    lastSeq: -1,
    updatedAt: 0,
    needsRead: false,
  };
}

function emptyBucket() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    cost: 0,
    costKnown: true,
  };
}

function addToBucket(bucket, record, rates) {
  const usage = record.usage;
  // DSH's DeepSeek adapter records prompt-cache hits separately from the
  // uncached prompt. `inputTokens` is therefore the miss portion, and
  // `totalTokens` is the full billable prompt + completion count.
  const input = asCount(usage.inputTokens);
  const output = asCount(usage.outputTokens);
  const cacheRead = asCount(usage.cacheReadTokens);
  const cacheWrite = asCount(usage.cacheWriteTokens);
  const tokens = asCount(usage.totalTokens) || input + cacheRead + cacheWrite + output;

  bucket.input += input;
  bucket.output += output;
  bucket.cacheRead += cacheRead;
  bucket.cacheWrite += cacheWrite;
  bucket.tokens += tokens;

  if (rates === null) {
    bucket.costKnown = false;
    return;
  }
  bucket.cost += (
    cacheRead * rates.cacheRead
    + cacheWrite * rates.input
    + input * rates.input
    + output * rates.output
  ) / 1_000_000;
}

function applyRecord(entry, record) {
  const time = asTime(record.time);
  const rates = ratesFor(record.provider, record.model, time);
  const key = localDayKey(time);
  const bucket = entry.days[key] ?? (entry.days[key] = emptyBucket());
  addToBucket(entry, record, rates);
  addToBucket(bucket, record, rates);
  if (rates === null) entry.costKnown = false;
  if (time > entry.updatedAt) entry.updatedAt = time;
}

function recordFromEvent(event) {
  const seq = Number(event.seq);
  const usage = event.data?.usage;
  if (!usage) {
    return { seq, time: asTime(event.time), usage: null, provider: undefined, model: undefined };
  }
  return {
    seq,
    time: asTime(event.time),
    usage,
    provider: event.data?.message?.source?.provider,
    model: event.data?.message?.source?.model,
  };
}

function publicSession(entry) {
  return {
    tokens: entry.tokens,
    input: entry.input,
    output: entry.output,
    cacheRead: entry.cacheRead,
    cacheWrite: entry.cacheWrite,
    cost: roundCost(entry.cost),
    costKnown: entry.costKnown,
    updatedAt: entry.updatedAt,
  };
}

function emptyAggregate() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    cost: 0,
    costKnown: true,
    sessions: 0,
  };
}

function addAggregate(target, source, countSession) {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.tokens += source.tokens;
  target.cost += source.cost;
  if (!source.costKnown) target.costKnown = false;
  if (countSession && source.tokens > 0) target.sessions += 1;
}

function finishAggregate(target) {
  return {
    ...target,
    cost: roundCost(target.cost),
  };
}

function mapLimit(items, limit, operation) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      await operation(items[index]);
    }
  });
  return Promise.all(workers);
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/** Services required by the Host half. */
export const inject = ['webServer'];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const entries = new Map();
  const pending = new Map();
  let loaded = false;
  let corpusDirty = true;
  let lastList = 0;
  let loading;

  function remember(id, record) {
    let records = pending.get(id);
    if (records === undefined) {
      records = new Map();
      pending.set(id, records);
    }
    records.set(record.seq, record);
    while (records.size > PENDING_LIMIT) {
      const oldest = records.keys().next().value;
      records.delete(oldest);
    }
  }

  function replayPending(id, entry, afterSeq) {
    const records = pending.get(id);
    if (records === undefined) return;
    const ordered = [...records.values()].sort((left, right) => left.seq - right.seq);
    for (const record of ordered) {
      if (record.seq <= afterSeq || record.usage === null) continue;
      applyRecord(entry, record);
      if (record.seq > entry.lastSeq) entry.lastSeq = record.seq;
    }
    for (const seq of records.keys()) {
      if (seq <= entry.lastSeq) records.delete(seq);
    }
    if (records.size === 0) pending.delete(id);
  }

  function buildEntry(id, snapshot) {
    const entry = emptyStats();
    const inherited = Number(snapshot.inheritedEventCount) || 0;
    let lastSeq = -1;
    for (const event of snapshot.events) {
      const seq = Number(event.seq);
      if (Number.isFinite(seq) && seq > lastSeq) lastSeq = seq;
      if (event.type !== 'assistant/message') continue;
      if (!event.data?.usage) continue;
      if (Number.isFinite(seq) && seq < inherited) continue;
      applyRecord(entry, recordFromEvent(event));
    }
    entry.lastSeq = lastSeq;
    entry.needsRead = false;
    replayPending(id, entry, lastSeq);
    return entry;
  }

  async function refreshCorpus() {
    const sessionQuery = ctx.get('sessionQuery');
    if (sessionQuery === undefined) throw new Error('session query service is unavailable');
    const records = await sessionQuery.listSessions();
    const ids = new Set();
    const reads = [];
    for (const record of records) {
      const id = String(record.header.id);
      ids.add(id);
      const entry = entries.get(id);
      if (entry === undefined || entry.needsRead) reads.push(id);
    }
    await mapLimit(reads, 4, async (id) => {
      try {
        const snapshot = await sessionQuery.readSession(id);
        // `buildEntry` replays any newer live events synchronously before the
        // store publication, so no event is lost between read and install.
        entries.set(id, buildEntry(id, snapshot));
      } catch (error) {
        console.warn('[dsh-usage-meter] session read failed', { id, error });
        const entry = entries.get(id);
        if (entry !== undefined) entry.needsRead = false;
      }
    });
    for (const id of entries.keys()) {
      if (!ids.has(id)) entries.delete(id);
    }
    loaded = true;
    corpusDirty = false;
    lastList = Date.now();
  }

  function ensureFresh() {
    if (loading !== undefined) return loading;
    if (!loaded || corpusDirty || Date.now() - lastList > CORPUS_REFRESH_MS) {
      loading = refreshCorpus().finally(() => {
        loading = undefined;
      });
      return loading;
    }
    return Promise.resolve();
  }

  async function snapshot() {
    await ensureFresh();
    const todayKey = localDayKey(Date.now());
    const today = emptyAggregate();
    const total = emptyAggregate();
    const sessions = Object.create(null);
    let updatedAt = 0;
    for (const [id, entry] of entries) {
      if (entry.updatedAt > updatedAt) updatedAt = entry.updatedAt;
      const day = entry.days[todayKey];
      if (day !== undefined) addAggregate(today, day, true);
      addAggregate(total, entry, true);
      if (entry.tokens > 0) sessions[id] = publicSession(entry);
    }
    return {
      ok: true,
      generatedAt: Date.now(),
      todayKey,
      updatedAt,
      today: finishAggregate(today),
      total: finishAggregate(total),
      sessions,
    };
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end();
        return;
      }
      try {
        const data = await snapshot();
        const payload = JSON.stringify(data);
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-length': Buffer.byteLength(payload),
        });
        if (request.method === 'HEAD') response.end();
        else response.end(payload);
      } catch (error) {
        console.error('[dsh-usage-meter] usage snapshot failed', error);
        sendJson(response, 503, { ok: false, error: 'usage-unavailable' });
      }
    },
  }), 'usage meter: HTTP route');

  ctx.on('session/event', (session, event) => {
    const id = String(session.id);
    const record = recordFromEvent(event);
    if (record.usage !== null) remember(id, record);
    let entry = entries.get(id);
    if (entry === undefined) {
      entry = emptyStats();
      entry.needsRead = true;
      entries.set(id, entry);
    }
    if (record.seq <= entry.lastSeq) return;
    if (record.usage !== null) applyRecord(entry, record);
    entry.lastSeq = record.seq;
  });

  ctx.on('api-session/added', () => {
    corpusDirty = true;
  });
  ctx.on('session/created', () => {
    corpusDirty = true;
  });
  ctx.on('session/disposed', () => {
    corpusDirty = true;
  });
}
