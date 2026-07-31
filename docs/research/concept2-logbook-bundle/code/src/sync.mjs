import {
  getResult,
  getStrokes,
  listResults,
  normalizeResult,
} from "./concept2-api.mjs";

export async function hydrateResult({
  accessToken,
  summary,
  fetchImpl = globalThis.fetch,
  syncedAt,
} = {}) {
  const resultId = summary && summary.id;
  if (resultId == null) {
    throw new TypeError("summary.id is required");
  }

  const detail = await getResult({
    accessToken,
    resultId,
    include: "strokes,metadata,user",
    fetchImpl,
  });

  let strokes = null;
  let strokeDataUnavailable = false;
  try {
    strokes = await getStrokes({ accessToken, resultId, fetchImpl });
  } catch (error) {
    if (error && error.status === 404) {
      strokeDataUnavailable = true;
    } else {
      throw error;
    }
  }

  return {
    raw: { summary, detail, strokes },
    normalized: normalizeResult(detail, { strokes, syncedAt }),
    strokeDataUnavailable,
  };
}

export async function syncResults({
  accessToken,
  updatedAfter,
  from,
  to,
  type,
  page = 1,
  number = 250,
  maxPages = 100,
  fetchImpl = globalThis.fetch,
  syncedAt = new Date().toISOString(),
} = {}) {
  const hydrated = [];
  const pages = [];
  let currentPage = page;

  for (let count = 0; count < maxPages; count += 1) {
    const response = await listResults({
      accessToken,
      page: currentPage,
      number,
      from,
      to,
      type,
      updatedAfter,
      fetchImpl,
    });
    const summaries = Array.isArray(response && response.data) ? response.data : [];
    pages.push({ page: currentPage, count: summaries.length, raw: response });
    for (const summary of summaries) {
      hydrated.push(await hydrateResult({
        accessToken,
        summary,
        fetchImpl,
        syncedAt,
      }));
    }

    const pagination = response && response.meta && response.meta.pagination;
    const totalPages = Number((pagination && pagination.total_pages) || currentPage);
    if (currentPage >= totalPages || summaries.length === 0) {
      break;
    }
    currentPage += 1;
  }

  return {
    results: hydrated,
    pages,
    pageCount: pages.length,
    truncated: pages.length >= maxPages,
    syncedAt,
  };
}
