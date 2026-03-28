const fallbackPosts = [
  {
    id: "local-gpt5-release",
    title: "GPT-5 发布：多模态能力全面升级，推理速度提升三倍",
    category: "随笔杂谈",
    tags: ["GPT-5", "OpenAI", "多模态", "大语言模型"],
    created_time: "2026-03-15T00:00:00.000Z",
    excerpt: "本地示例文章，用于 Worker 不可用时的兜底显示。",
    cover: "cover-1",
    blocks: [
      { type: "heading_2", heading_2: { rich_text: [{ plain_text: "一、发布背景" }] } },
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              plain_text:
                "2026年3月，OpenAI 在开发者大会上正式发布了 GPT-5。与前代相比，它不仅在能力上继续扩展，更重要的是交互速度和复杂任务推理的稳定性得到了明显改善。"
            }
          ]
        }
      },
      { type: "heading_2", heading_2: { rich_text: [{ plain_text: "二、行业影响" }] } },
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              plain_text:
                "模型能力提升之后，真正有竞争力的产品不再只是接入模型，而是能把模型嵌入稳定且清楚的流程。"
            }
          ]
        }
      }
    ]
  }
];

const config = {
  apiBase: window.BLOG_CONFIG?.apiBase || ""
};

const state = {
  posts: [],
  currentCat: "all",
  currentQuery: "",
  currentArticleId: null,
  postDetails: new Map()
};

function buildApiUrl(path) {
  return `${config.apiBase}${path}`;
}

function setStatus(message, isError = false) {
  const status = document.querySelector("[data-status]");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDisplayDate(value) {
  if (!value) {
    return "未设置日期";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function normalizeCategory(value) {
  const raw = String(value || "").trim();
  const map = {
    "AI日报": "ai",
    "AI 日报": "ai",
    ai: "ai",
    "学术论文": "paper",
    paper: "paper",
    "随笔杂谈": "essay",
    essay: "essay"
  };
  return map[raw] || "essay";
}

function categoryLabel(cat) {
  const map = {
    ai: "AI日报",
    paper: "学术论文",
    essay: "随笔杂谈"
  };
  return map[cat] || "随笔杂谈";
}

function normalizePost(post, index) {
  const cat = normalizeCategory(post.cat || post.category);
  const title = post.title || post.name || "无标题";
  const createdTime = post.created_time || post.date || "";

  return {
    id: post.id || `post-${index + 1}`,
    title,
    name: title,
    cat,
    category: post.category || categoryLabel(cat),
    catLabel: post.catLabel || categoryLabel(cat),
    tags: Array.isArray(post.tags) ? post.tags : [],
    created_time: createdTime,
    date: formatDisplayDate(createdTime),
    excerpt: post.excerpt || "这篇文章来自 Notion 数据库，点击后可查看正文内容。",
    cover: post.cover || `cover-${(index % 6) + 1}`,
    blocks: Array.isArray(post.blocks) ? post.blocks : []
  };
}

async function loadPosts() {
  const response = await fetch(buildApiUrl("/posts"), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`文章接口请求失败：${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("文章接口返回格式错误，应返回数组。");
  }

  return payload.map(normalizePost);
}

function mapRichText(items = []) {
  return items.map((item) => item.plain_text || "").join("").trim();
}

function mapNotionBlocks(blocks) {
  const content = [];
  const sections = [];

  blocks.forEach((block) => {
    if (block.type === "heading_1" || block.type === "heading_2" || block.type === "heading_3") {
      const text = mapRichText(block[block.type]?.rich_text || []);
      if (text) {
        content.push({ type: "section", text });
        sections.push({ title: text, sub: [] });
      }
      return;
    }

    if (block.type === "paragraph") {
      const text = mapRichText(block.paragraph?.rich_text || []);
      if (text) {
        content.push({ type: "p", text });
      }
      return;
    }

    if (block.type === "quote") {
      const text = mapRichText(block.quote?.rich_text || []);
      if (text) {
        content.push({ type: "quote", text });
      }
      return;
    }

    if (block.type === "bulleted_list_item") {
      const text = mapRichText(block.bulleted_list_item?.rich_text || []);
      if (text) {
        content.push({ type: "p", text: `• ${text}` });
      }
      return;
    }

    if (block.type === "numbered_list_item") {
      const text = mapRichText(block.numbered_list_item?.rich_text || []);
      if (text) {
        content.push({ type: "p", text: `1. ${text}` });
      }
      return;
    }

    if (block.type === "callout") {
      const text = mapRichText(block.callout?.rich_text || []);
      if (text) {
        content.push({ type: "quote", text });
      }
    }
  });

  if (!sections.length && content.length) {
    sections.push({ title: "正文", sub: [] });
  }

  return { content, sections };
}

async function loadPostDetail(id) {
  if (state.postDetails.has(id)) {
    return state.postDetails.get(id);
  }

  const response = await fetch(buildApiUrl(`/posts/${encodeURIComponent(id)}`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`文章详情接口请求失败：${response.status}`);
  }

  const blocks = await response.json();
  if (!Array.isArray(blocks)) {
    throw new Error("文章详情接口返回格式错误，应返回 block 数组。");
  }

  const summary = state.posts.find((entry) => String(entry.id) === String(id));
  if (!summary) {
    throw new Error("未找到文章摘要信息。");
  }

  const detail = {
    ...summary,
    blocks,
    ...mapNotionBlocks(blocks)
  };

  state.postDetails.set(id, detail);
  return detail;
}

function filteredPosts() {
  return state.posts.filter((post) => {
    const matchesCat = state.currentCat === "all" || post.cat === state.currentCat;
    const text = [post.title, post.excerpt, ...post.tags].join(" ").toLowerCase();
    const matchesQuery = !state.currentQuery || text.includes(state.currentQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });
}

function renderCover(cover, title) {
  if (typeof cover === "string" && /^(https?:)?\/\//.test(cover)) {
    return `<img class="post-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(title)}">`;
  }

  return `<div class="post-cover ${escapeHtml(cover)}"></div>`;
}

function renderPosts() {
  const list = document.getElementById("post-list");
  const posts = filteredPosts();

  if (!posts.length) {
    list.innerHTML = '<div class="empty-state">没有匹配的文章。</div>';
    return;
  }

  list.innerHTML = posts
    .map(
      (post, index) => `
        <div class="post-item" data-post-id="${escapeHtml(post.id)}" style="animation-delay:${index * 0.07}s">
          <div class="post-info">
            <div class="post-category-tag">${escapeHtml(post.catLabel)}</div>
            <div class="post-title">${escapeHtml(post.title)}</div>
            <div class="post-excerpt">${escapeHtml(post.excerpt)}</div>
            <div class="post-tags">${post.tags
              .map((tag) => `<span class="post-tag">${escapeHtml(tag)}</span>`)
              .join("")}</div>
            <div class="post-meta">创建于 ${escapeHtml(post.date)}</div>
          </div>
          <div class="post-cover-wrap">
            ${renderCover(post.cover, post.title)}
          </div>
        </div>
      `
    )
    .join("");

  list.querySelectorAll("[data-post-id]").forEach((item) => {
    item.addEventListener("click", () => {
      showArticle(item.dataset.postId);
    });
  });
}

function renderTabs() {
  document.querySelectorAll("[data-tab-btn]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tabBtn === state.currentCat);
  });
}

function showPage(name) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.getElementById(`page-${name}`).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToSection(id) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderArticle(post) {
  const articleSections = post.sections.length ? post.sections : [{ title: "正文", sub: [] }];
  const articleContent = post.content.length
    ? post.content
    : [{ type: "p", text: "这篇文章当前没有可显示的正文内容。" }];

  document.getElementById("article-hero-content").innerHTML = `
    <button class="back-btn" data-back-home>
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l-5 5 5 5"/></svg>
      返回首页
    </button>
    <div class="article-hero-tags">${post.tags
      .map((tag) => `<span class="article-hero-tag">${escapeHtml(tag)}</span>`)
      .join("")}</div>
    <div class="article-hero-title">${escapeHtml(post.title)}</div>
    <div class="article-hero-subtitle">${escapeHtml(post.excerpt)}</div>
    <div class="article-hero-meta">
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2a6 6 0 100 12A6 6 0 0010 2zm0 0v4m0 0l3 2"/></svg>
      创建于 ${escapeHtml(post.date)}
    </div>
  `;

  document.querySelector("[data-back-home]").addEventListener("click", () => showPage("home"));

  document.getElementById("article-content").innerHTML =
    '<div class="article-ai-note">（正文由 Notion 页面 block 内容生成）</div>' +
    articleContent
      .map((block, index) => {
        if (block.type === "section") {
          const parts = block.text.split("、");
          const anchor = `section-${index}`;
          return `<h2 class="article-section-title" id="${anchor}"><span class="num">${escapeHtml(
            parts.length > 1 ? `${parts[0]}、` : `${index + 1}.`
          )}</span>${escapeHtml(parts.length > 1 ? parts.slice(1).join("、") : block.text)}</h2>`;
        }

        if (block.type === "quote") {
          return `<blockquote class="article-blockquote">${escapeHtml(block.text)}</blockquote>`;
        }

        return `<p class="article-p">${escapeHtml(block.text)}</p>`;
      })
      .join("");

  const sectionAnchors = [];
  document.querySelectorAll(".article-section-title").forEach((heading) => {
    sectionAnchors.push({ id: heading.id });
  });

  document.getElementById("catalog-list").innerHTML = articleSections
    .map((section, index) => {
      const anchor = sectionAnchors[index]?.id || "";
      const parent = `<li class="catalog-item" data-anchor="${anchor}">${escapeHtml(section.title)}</li>`;
      const children = (section.sub || [])
        .map((sub) => `<li class="catalog-item sub">${escapeHtml(sub)}</li>`)
        .join("");
      return parent + children;
    })
    .join("");

  document.querySelectorAll("[data-anchor]").forEach((item) => {
    item.addEventListener("click", () => {
      const anchor = item.dataset.anchor;
      if (!anchor) {
        return;
      }
      scrollToSection(anchor);
      document.querySelectorAll("[data-anchor]").forEach((node) => node.classList.remove("active"));
      item.classList.add("active");
    });
  });

  showPage("article");
}

async function showArticle(id) {
  const summary = state.posts.find((entry) => String(entry.id) === String(id));
  if (!summary) {
    return;
  }

  setStatus("正在加载文章详情…");

  try {
    const post = await loadPostDetail(id);
    renderArticle(post);
    setStatus(`已加载 ${state.posts.length} 篇文章。`);
  } catch (error) {
    console.error(error);
    const fallback = fallbackPosts[0];
    renderArticle({
      ...normalizePost(fallback, 0),
      ...mapNotionBlocks(fallback.blocks)
    });
    setStatus("详情接口加载失败，已回退到本地示例文章。", true);
  }
}

function updateCategory(cat) {
  state.currentCat = cat;
  renderTabs();
  renderPosts();
}

function bindEvents() {
  document.querySelector("[data-nav-home]").addEventListener("click", (event) => {
    event.preventDefault();
    showPage("home");
    updateCategory("all");
  });

  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPage("home");
      updateCategory(link.dataset.navLink);
    });
  });

  document.querySelectorAll("[data-tab-btn]").forEach((button) => {
    button.addEventListener("click", () => updateCategory(button.dataset.tabBtn));
  });

  document.querySelector("[data-search-form]").addEventListener("submit", (event) => {
    event.preventDefault();
  });

  document.querySelector("[data-search-input]").addEventListener("input", (event) => {
    state.currentQuery = event.target.value.trim();
    renderPosts();
  });
}

async function init() {
  bindEvents();
  setStatus("正在加载文章…");

  try {
    state.posts = await loadPosts();
    renderTabs();
    renderPosts();
    setStatus(`已从 Notion 数据库加载 ${state.posts.length} 篇文章。`);
  } catch (error) {
    console.error(error);
    state.posts = fallbackPosts.map(normalizePost);
    renderTabs();
    renderPosts();
    setStatus("Notion 接口加载失败，已回退到本地示例文章。", true);
  }
}

init();
