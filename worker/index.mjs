const NOTION_VERSION = "2025-09-03";
const CACHE_MAX_AGE = 300;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    try {
      if (url.pathname === "/api/posts") {
        return await handlePosts(request, env, ctx);
      }

      if (url.pathname.startsWith("/api/post/")) {
        const slug = decodeURIComponent(url.pathname.replace("/api/post/", ""));
        return await handlePostBySlug(request, slug, env, ctx);
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json(
        {
          error: "Worker request failed.",
          details: error.message
        },
        500
      );
    }
  }
};

async function handlePosts(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return withCors(cached);
  }

  const dataSourceId = await getDataSourceId(env);
  const payload = await notionFetch(`/data_sources/${dataSourceId}/query`, env, {
    method: "POST",
    body: JSON.stringify({
      page_size: 100,
      sorts: [{ property: "date", direction: "descending" }]
    })
  });

  const posts = (payload.results || []).map((page, index) => mapPageSummary(page, index));
  const response = json({ posts });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handlePostBySlug(request, slug, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return withCors(cached);
  }

  const dataSourceId = await getDataSourceId(env);
  const payload = await notionFetch(`/data_sources/${dataSourceId}/query`, env, {
    method: "POST",
    body: JSON.stringify({
      page_size: 1,
      filter: {
        property: "slug",
        rich_text: {
          equals: slug
        }
      }
    })
  });

  const page = payload.results?.[0];
  if (!page) {
    return json({ error: "Post not found." }, 404);
  }

  const blocks = await listAllBlockChildren(page.id, env);
  const response = json(mapPageDetail(page, blocks));
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function getDataSourceId(env) {
  if (env.NOTION_DATA_SOURCE_ID) {
    return env.NOTION_DATA_SOURCE_ID;
  }

  if (!env.NOTION_DATABASE_ID) {
    throw new Error("Missing NOTION_DATABASE_ID.");
  }

  const database = await notionFetch(`/databases/${env.NOTION_DATABASE_ID}`, env, {
    method: "GET"
  });

  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new Error("No data source found under NOTION_DATABASE_ID.");
  }

  return dataSourceId;
}

async function listAllBlockChildren(blockId, env, startCursor = null, acc = []) {
  const query = new URLSearchParams({ page_size: "100" });
  if (startCursor) {
    query.set("start_cursor", startCursor);
  }

  const payload = await notionFetch(`/blocks/${blockId}/children?${query.toString()}`, env, {
    method: "GET"
  });

  const merged = acc.concat(payload.results || []);
  if (payload.has_more && payload.next_cursor) {
    return listAllBlockChildren(blockId, env, payload.next_cursor, merged);
  }

  return merged;
}

async function notionFetch(path, env, init) {
  if (!env.NOTION_TOKEN) {
    throw new Error("Missing NOTION_TOKEN.");
  }

  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`${path} -> ${response.status} ${details}`);
  }

  return response.json();
}

function mapPageSummary(page, index) {
  const props = page.properties || {};
  const category = getSelectName(props.category);
  const cover = page.cover?.external?.url || page.cover?.file?.url || `cover-${(index % 6) + 1}`;

  return {
    id: page.id,
    slug: getRichText(props.slug) || page.id,
    cat: normalizeCategory(category),
    catLabel: category || "随笔杂谈",
    title: getTitle(props.title) || "未命名文章",
    excerpt: getRichText(props.excerpt),
    tags: getMultiSelect(props.tags),
    date: formatDate(props.date?.date?.start),
    author: getRichText(props.author) || "霙樱怪",
    cover,
    sections: []
  };
}

function mapPageDetail(page, blocks) {
  const summary = mapPageSummary(page, 0);
  const content = [];
  const sections = [];

  blocks.forEach((block) => {
    const item = mapBlock(block);
    if (!item) {
      return;
    }

    content.push(item);
    if (item.type === "section") {
      sections.push({
        title: item.text,
        sub: []
      });
    }
  });

  return {
    ...summary,
    sections,
    content
  };
}

function mapBlock(block) {
  switch (block.type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return {
        type: "section",
        text: readBlockText(block[block.type])
      };
    case "paragraph": {
      const text = readBlockText(block.paragraph);
      return text ? { type: "p", text } : null;
    }
    case "quote": {
      const text = readBlockText(block.quote);
      return text ? { type: "quote", text } : null;
    }
    case "bulleted_list_item": {
      const text = readBlockText(block.bulleted_list_item);
      return text ? { type: "p", text: `• ${text}` } : null;
    }
    case "numbered_list_item": {
      const text = readBlockText(block.numbered_list_item);
      return text ? { type: "p", text: `1. ${text}` } : null;
    }
    case "to_do": {
      const text = readBlockText(block.to_do);
      return text ? { type: "p", text: `${block.to_do.checked ? "[x]" : "[ ]"} ${text}` } : null;
    }
    case "callout": {
      const text = readBlockText(block.callout);
      return text ? { type: "quote", text } : null;
    }
    default:
      return null;
  }
}

function readBlockText(value) {
  return (value?.rich_text || []).map((item) => item.plain_text).join("").trim();
}

function getTitle(property) {
  return (property?.title || []).map((item) => item.plain_text).join("");
}

function getRichText(property) {
  return (property?.rich_text || []).map((item) => item.plain_text).join("");
}

function getMultiSelect(property) {
  return (property?.multi_select || []).map((item) => item.name);
}

function getSelectName(property) {
  return property?.select?.name || "";
}

function normalizeCategory(value) {
  if (value === "AI日报" || value === "AI 日报" || value === "ai") {
    return "ai";
  }

  if (value === "学术论文" || value === "科研论文" || value === "paper") {
    return "paper";
  }

  return "essay";
}

function formatDate(value) {
  if (!value) {
    return "未设置日期";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, s-maxage=${CACHE_MAX_AGE}`,
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function withCors(response) {
  const cloned = new Response(response.body, response);
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    cloned.headers.set(key, value);
  });
  return cloned;
}
