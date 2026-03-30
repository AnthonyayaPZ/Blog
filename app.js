const fallbackPosts = [
  {
    id: "local-gpt5-release",
    title: "GPT-5 发布：多模态能力全面升级，推理速度提升三倍",
    category: "随笔杂谈",
    tags: ["GPT-5", "OpenAI", "多模态", "大语言模型"],
    created_time: "2026-03-15T00:00:00.000Z",
    excerpt: "本地示例文章，用于 Worker 不可用时的兜底显示。",
    cover: "cover-1",
    markdown: `## 一、发布背景\n\n2026年3月，OpenAI 在开发者大会上正式发布了 GPT-5。与前代相比，它不仅在能力上继续扩展，更重要的是交互速度和复杂任务推理的稳定性得到了明显改善。\n\n## 二、行业影响\n\n模型能力提升之后，真正有竞争力的产品不再只是接入模型，而是能把模型嵌入稳定且清楚的流程。`
  }
];

const config = {
  apiBase: window.BLOG_CONFIG?.apiBase || ""
};

const state = {
  posts: [],
  currentCat: "all",
  currentQuery: "",
  postDetails: new Map()
};

function buildApiUrl(path) {
  return `${config.apiBase}${path}`;
}

function pageType() {
  return document.body.dataset.page || "home";
}

function setStatus(message, isError = false) {
  const status = document.querySelector("[data-status]");
  if (!status) {
    return;
  }
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
    "科研论文": "paper",
    paper: "paper",
    "随笔杂谈": "essay",
    essay: "essay"
  };
  return map[raw] || "essay";
}

function categoryLabel(cat) {
  const map = {
    ai: "AI日报",
    paper: "科研论文",
    essay: "随笔杂谈"
  };
  return map[cat] || "随笔杂谈";
}

function postUrl(post) {
  return `./post.html?id=${encodeURIComponent(post.id)}`;
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
    markdown: post.markdown || ""
  };
}

// ── localStorage cache with TTL ──────────────────────────────────────────
const LS_TTL = {
  posts:    5  * 60 * 1000,   // 文章列表  5 分钟
  postFull: 10 * 60 * 1000,   // 文章详情 10 分钟
};

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, exp } = JSON.parse(raw);
    if (Date.now() > exp) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function lsSet(key, data, ttl) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, exp: Date.now() + ttl }));
  } catch { /* 存储满时静默忽略 */ }
}
// ─────────────────────────────────────────────────────────────────────────

async function loadPosts() {
  const cacheKey = "blog:posts";
  const cached = lsGet(cacheKey);
  if (cached) return cached;

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

  const posts = payload.map(normalizePost);
  lsSet(cacheKey, posts, LS_TTL.posts);
  return posts;
}

async function loadPostDetail(id) {
  // 1. 内存缓存（同一页面会话中最快）
  if (state.postDetails.has(id)) {
    return state.postDetails.get(id);
  }

  // 2. localStorage 缓存（刷新页面后仍有效）
  const cacheKey = `blog:post:${id}`;
  const cached = lsGet(cacheKey);
  if (cached) {
    state.postDetails.set(id, cached);
    return cached;
  }

  const response = await fetch(buildApiUrl(`/posts/${encodeURIComponent(id)}?full=true`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`文章详情接口请求失败：${response.status}`);
  }

  const payload = await response.json();
  const meta = payload?.meta;
  const markdown = payload?.markdown;

  if (!meta || typeof markdown !== "string") {
    throw new Error("文章详情接口返回格式错误，应返回包含 meta 和 markdown 的对象。");
  }

  const detail = {
    ...normalizePost(meta, 0),
    markdown
  };

  // 3. 写入两级缓存
  lsSet(cacheKey, detail, LS_TTL.postFull);
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
        <a class="post-item" href="${postUrl(post)}" style="animation-delay:${index * 0.07}s">
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
        </a>
      `
    )
    .join("");
}

function renderTabs() {
  document.querySelectorAll("[data-tab-btn]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tabBtn === state.currentCat);
  });
}

function scrollToSection(id) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderArticle(post) {
  document.title = `${post.title} | 霙樱怪的个人博客`;

  document.getElementById("article-hero-content").innerHTML = `
    <a class="back-btn" href="./index.html">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l-5 5 5 5"/></svg>
      返回首页
    </a>
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

  // Render Markdown → HTML
  const contentEl = document.getElementById("article-content");
  const markdown = post.markdown || "这篇文章当前没有可显示的正文内容。";
  contentEl.innerHTML = marked.parse(markdown);

  // Assign IDs to headings and collect catalog entries
  const sections = [];
  let currentSection = null;
  contentEl.querySelectorAll("h2, h3").forEach((heading, index) => {
    const id = `section-${index}`;
    heading.id = id;
    if (heading.tagName === "H2") {
      currentSection = { title: heading.textContent, sub: [], id };
      sections.push(currentSection);
    } else if (heading.tagName === "H3" && currentSection) {
      currentSection.sub.push({ title: heading.textContent, id });
    }
  });

  if (!sections.length) {
    sections.push({ title: "正文", sub: [], id: "" });
  }

  document.getElementById("catalog-list").innerHTML = sections
    .map((section) => {
      const parent = `<li class="catalog-item" data-anchor="${section.id}">${escapeHtml(section.title)}</li>`;
      const children = section.sub
        .map((sub) => `<li class="catalog-item sub" data-anchor="${sub.id}">${escapeHtml(sub.title)}</li>`)
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
}

async function initHomePage() {
  document.querySelector("[data-nav-home]")?.addEventListener("click", (event) => {
    event.preventDefault();
    window.location.href = "./index.html";
  });

  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      state.currentCat = link.dataset.navLink;
      renderTabs();
      renderPosts();
    });
  });

  document.querySelectorAll("[data-tab-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentCat = button.dataset.tabBtn;
      renderTabs();
      renderPosts();
    });
  });

  document.querySelector("[data-search-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  document.querySelector("[data-search-input]")?.addEventListener("input", (event) => {
    state.currentQuery = event.target.value.trim();
    renderPosts();
  });

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

async function initPostPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    renderArticle(normalizePost(fallbackPosts[0], 0));
    return;
  }

  try {
    const post = await loadPostDetail(id);
    renderArticle(post);
  } catch (error) {
    console.error(error);
    renderArticle(normalizePost(fallbackPosts[0], 0));
  }
}

if (pageType() === "home") {
  initHomePage();
}

if (pageType() === "post") {
  initPostPage();
}
