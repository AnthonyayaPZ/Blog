# 个人博客网站

本仓库包含一个基于静态页面的个人博客前端，以及一个通过 Cloudflare Worker 读取 Notion Database 内容的服务端实现。

当前博客采用以下运行方式：

- 静态页面负责展示首页与文章详情页
- Cloudflare Worker 负责提供文章列表与正文内容接口
- Notion 作为内容管理来源

## 项目结构

- [index.html](/Users/lipeizhang/Downloads/code/vibe/Blog/index.html)：博客首页
- [post.html](/Users/lipeizhang/Downloads/code/vibe/Blog/post.html)：文章详情页
- [styles.css](/Users/lipeizhang/Downloads/code/vibe/Blog/styles.css)：页面样式
- [app.js](/Users/lipeizhang/Downloads/code/vibe/Blog/app.js)：前端渲染逻辑
- [site.config.js](/Users/lipeizhang/Downloads/code/vibe/Blog/site.config.js)：前端接口地址配置
- [scripts/index.js](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/index.js)：Cloudflare Worker 入口
- [scripts/test-worker.mjs](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/test-worker.mjs)：Worker 返回内容测试脚本
- [wrangler.jsonc](/Users/lipeizhang/Downloads/code/vibe/Blog/wrangler.jsonc)：Wrangler 配置文件

## 架构说明

本项目采用“静态前端 + Worker 接口 + Notion 内容源”的结构。

运行流程如下：

1. 浏览器访问静态页面
2. 前端请求 Cloudflare Worker 接口
3. Worker 使用 Notion Integration 访问 Notion API
4. Worker 返回文章列表、标签统计或完整文章详情数据
5. 前端将返回内容渲染为博客页面

前端不会直接请求 Notion API，因此不会在浏览器中暴露 Notion token。

## 当前页面结构

### 首页

[index.html](/Users/lipeizhang/Downloads/code/vibe/Blog/index.html) 用于展示文章列表。

首页会请求：

- `GET /posts`

每篇文章都会生成一个独立链接，形式如下：

```text
post.html?id=<page-id>
```

### 文章详情页

[post.html](/Users/lipeizhang/Downloads/code/vibe/Blog/post.html) 用于展示单篇文章内容。

详情页会从 URL 中读取 `id` 参数，并请求：

- `GET /posts/:id?full=true`

因此，当前博客中的每篇文章都拥有独立的页面地址，而不是在首页中以内联方式展开。

## Worker 接口说明

当前 Worker 实现位于 [scripts/index.js](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/index.js)，公开提供以下接口。

### `GET /`

健康检查接口。

示例返回：

```json
{
  "status": "ok",
  "timestamp": "2026-03-29T00:00:00.000Z"
}
```

### `GET /db`

返回 Notion 数据库名称。

示例返回：

```json
{
  "name": "个人博客数据库"
}
```

### `GET /posts`

返回 Notion 数据库中的页面列表，并支持按标签与分类过滤。

可选查询参数：

- `tag`
- `category`

当前返回结构如下：

```json
[
  {
    "id": "page-id",
    "name": "文章标题",
    "created_time": "2026-03-29T00:00:00.000Z",
    "category": "随笔杂谈",
    "tags": ["阅读", "随笔"]
  }
]
```

字段说明：

- `id`：Notion 页面 ID，用于请求正文
- `name`：文章标题，来自数据库中的 `Name` 字段
- `created_time`：页面创建时间，来自 Notion page 顶层字段
- `category`：文章分类，来自数据库中的 `Category` 字段
- `tags`：文章标签列表，来自数据库中的 `Tags` 字段

### `GET /tags`

返回所有标签及其出现频次。

### `GET /graph`

返回基于标签共现关系生成的图谱节点和边数据。

### `GET /posts/:id`

默认返回指定 Notion 页面的一层正文 block 数据。

当请求带有 `full=true` 参数时，返回完整文章元数据和正文 block。

`GET /posts/:id?full=true` 示例返回：

```json
{
  "meta": {
    "id": "page-id",
    "name": "文章标题",
    "created_time": "2026-03-29T00:00:00.000Z",
    "category": "随笔杂谈",
    "tags": ["阅读", "随笔"]
  },
  "blocks": [
    {
      "object": "block",
      "id": "block-id",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [
          {
            "plain_text": "一、引言"
          }
        ]
      }
    }
  ]
}
```

## Notion 数据库要求

根据当前 [scripts/index.js](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/index.js) 的实现，Notion 数据库至少应满足以下要求。

### 必需字段

- `Name`
  类型：`Title`

当前 Worker 中的标题读取方式如下：

```js
page.properties.Name?.title?.[0]?.plain_text
```

因此：

- 若字段名称不是 `Name`
- 或该字段不是 `Title` 类型

则文章标题将无法被正确读取。

### 正文来源

正文内容不通过数据库自定义字段返回，而是直接读取每个页面的 block 内容。

当前正文来源为：

```text
GET /v1/blocks/{page_id}/children
```

这意味着文章正文应直接编写在 Notion 页面本体中，而不是单独保存在某个文本字段里。

### 系统字段

当前代码还使用了 Notion page 顶层的系统创建时间：

```js
page.created_time
```

该值不是数据库自定义 property，无需手动创建。

## Notion 字段调整后的代码同步方式

若 Notion 数据库中的字段名称、字段类型或字段结构发生变化，需同步修改 [scripts/index.js](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/index.js) 中的字段映射逻辑。

当前列表接口中的主要映射位置如下：

```js
const posts = data.results.map(page => ({
  id: page.id,
  name: page.properties.Name?.title?.[0]?.plain_text ?? '无标题',
  created_time: page.created_time,
  category: page.properties.Category?.select?.name ?? '',
  tags,
}));
```

### 场景一：标题字段重命名

若将 Notion 中的标题字段从 `Name` 改为 `Title`，则需将：

```js
page.properties.Name
```

修改为：

```js
page.properties.Title
```

否则标题将退化为默认值 `无标题`。

### 场景二：分类字段变更

当前代码使用：

```js
page.properties.Category?.select?.name ?? ''
```

若 `Category` 的字段名或类型发生变化，需要同步修改这段映射逻辑。

### 场景三：标签字段变更

当前代码默认 `Tags` 为一个使用逗号分隔的 `Rich text` 字段，并通过以下方式解析：

```js
const rawTags = page.properties.Tags?.rich_text?.[0]?.plain_text ?? '';
const tags = rawTags
  .split(',')
  .map(t => t.trim())
  .filter(Boolean);
```

若 `Tags` 改为其他字段名或其他类型，也需要同步修改解析逻辑。

### 说明

一旦 Worker 返回结构发生变化，前端 [app.js](/Users/lipeizhang/Downloads/code/vibe/Blog/app.js) 中相应的渲染逻辑也应同步更新，以确保新增字段可以被页面正确展示。

## 前端正文渲染能力

当前前端会将 Notion blocks 转换为博客正文内容，并支持以下 block 类型：

- `heading_1`
- `heading_2`
- `heading_3`
- `paragraph`
- `quote`
- `bulleted_list_item`
- `numbered_list_item`
- `callout`

未包含在上述列表中的 block 类型，当前版本不会渲染。

## 接口地址配置

前端通过 [site.config.js](/Users/lipeizhang/Downloads/code/vibe/Blog/site.config.js) 指定 Worker 地址。

示例：

```js
window.BLOG_CONFIG = {
  apiBase: "https://notion-proxy.nmnm7782525250.workers.dev"
};
```

若前端与 Worker 部署在同一域名下，也可将 `apiBase` 配置为空字符串。

## 测试脚本

仓库中提供了 Worker 测试脚本：

- [scripts/test-worker.mjs](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/test-worker.mjs)

运行方式：

```bash
node scripts/test-worker.mjs https://your-worker.workers.dev
```

该脚本将依次执行以下操作：

1. 请求 `/posts`
2. 输出文章列表概要
3. 取第一篇文章的 `id`
4. 请求 `/posts/:id`
5. 输出正文 block 摘要

## 详情页请求优化

当前版本已对文章详情页的加载链路进行优化。

当前线上 Worker 已支持：

```text
GET /posts/:id?full=true
```

该接口会一次性返回：

- `meta`
  包含文章标题、创建时间、分类和标签等元数据

- `blocks`
  包含正文 block 列表

因此，当前详情页加载流程如下：

1. 页面 URL 仅保留 `id`
2. 详情页请求一次 `GET /posts/:id?full=true`
3. 前端从返回结果中读取 `meta` 和 `blocks`
4. 前端渲染标题、分类、标签、日期与正文内容

该实现避免了详情页再次请求 `/posts`，同时也避免在 URL 中附带过多文章摘要信息。

## 部署说明

### 静态前端

当前前端文件结构可以直接部署到以下任意静态托管平台：

- GitHub Pages
- Cloudflare Pages
- Nginx
- 任意标准静态文件服务器

部署时需确保以下文件可被公开访问：

- `index.html`
- `post.html`
- `styles.css`
- `app.js`
- `site.config.js`
- `assets/`

### Cloudflare Worker

当前 Wrangler 入口配置位于 [wrangler.jsonc](/Users/lipeizhang/Downloads/code/vibe/Blog/wrangler.jsonc)：

```json
{
  "name": "blog-notion-worker",
  "main": "scripts/index.js",
  "compatibility_date": "2026-03-28"
}
```

这意味着当前对外接口行为，以 [scripts/index.js](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/index.js) 为准。
