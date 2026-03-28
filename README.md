# 个人博客网站

这个项目保留了 `blog.html` 的视觉风格，但当前真实数据来源已经对齐到 `scripts/index.js` 这版 Cloudflare Worker。

也就是说，现在网页读取的不是之前那套自定义 `/api/posts` 结构，而是：

- `GET /`：健康检查
- `GET /db`：返回 Notion 数据库名称
- `GET /posts`：返回 Notion 数据库中的条目列表
- `GET /posts/:id`：返回对应页面的正文 block

## 当前文件结构

- `index.html`：页面结构
- `styles.css`：页面样式
- `app.js`：前端逻辑，直接读取 `scripts/index.js` 暴露的接口
- `site.config.js`：前端接口地址配置
- `scripts/index.js`：Cloudflare Worker 入口
- `scripts/test-worker.mjs`：测试 Worker 返回内容的脚本
- `wrangler.jsonc`：Wrangler 配置

## 当前 Worker 的接口结构

### 1. `GET /`

用于健康检查。

示例返回：

```json
{
  "status": "ok",
  "timestamp": "2026-03-28T07:00:00.000Z"
}
```

### 2. `GET /db`

返回 Notion 数据库名称。

示例返回：

```json
{
  "name": "我的博客数据库"
}
```

### 3. `GET /posts`

返回数据库中的条目列表。

当前 `scripts/index.js` 里实际返回的字段只有：

```json
[
  {
    "id": "page-id",
    "name": "文章标题",
    "created_time": "2026-03-28T06:00:00.000Z"
  }
]
```

字段说明：

- `id`
  Notion page id，后续用于请求单篇文章正文

- `name`
  来自数据库中的 `Name` 字段

- `created_time`
  Notion 页面系统创建时间，来自 page 顶层字段，不是数据库自定义 property

### 4. `GET /posts/:id`

返回单篇文章的正文 blocks。

返回的是 Notion 原始 block 数组，例如：

```json
[
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
  },
  {
    "object": "block",
    "id": "block-id-2",
    "type": "paragraph",
    "paragraph": {
      "rich_text": [
        {
          "plain_text": "正文内容"
        }
      ]
    }
  }
]
```

## Notion 数据库当前要求的数据格式

按照 `scripts/index.js` 当前写法，数据库至少需要下面这些内容：

### 必需内容

- 数据库里必须存在 `Name` 字段
  类型：`Title`

因为代码里是这样取的：

```js
page.properties.Name?.title?.[0]?.plain_text
```

如果你的 Notion 数据库没有 `Name` 这个字段，或者它不是 `Title` 类型，`/posts` 就拿不到文章标题。

### 不需要你手动建的内容

- `created_time`
  这是 Notion 的系统字段，不是你自己创建的 property
  代码里通过：

```js
page.created_time
```

直接从 page 顶层读取。

### 正文内容

正文不通过数据库 property 存储，而是直接写在每个 Notion 页面中。  
`GET /posts/:id` 会通过：

```js
GET /v1/blocks/{page_id}/children
```

读取页面正文 block。

## 如果你在 Notion 数据库里修改了 property，代码要怎么同步

这是最关键的部分。

### 当前代码的 property 映射位置

需要修改的地方在 [scripts/index.js](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/index.js) 里的 `/posts` 路由：

```js
const posts = data.results.map(page => ({
  id: page.id,
  name: page.properties.Name?.title?.[0]?.plain_text ?? '无标题',
  created_time: page.created_time,
}));
```

也就是说，前端能拿到哪些字段，完全取决于这里返回了什么。

### 场景 1：你把 `Name` 改名了

比如你在 Notion 里把标题字段从 `Name` 改成了 `Title`，那么这里：

```js
page.properties.Name
```

就必须改成：

```js
page.properties.Title
```

否则标题会变成 `无标题`。

### 场景 2：你新增了分类字段

比如你在数据库里增加了：

- `Category`
  类型：`Select`

那就要在 `/posts` 的返回结构里加上：

```js
category: page.properties.Category?.select?.name ?? '',
```

完整例子：

```js
const posts = data.results.map(page => ({
  id: page.id,
  name: page.properties.Name?.title?.[0]?.plain_text ?? '无标题',
  category: page.properties.Category?.select?.name ?? '',
  created_time: page.created_time,
}));
```

然后前端 [app.js](/Users/lipeizhang/Downloads/code/vibe/Blog/app.js) 才能读取并渲染这个字段。

### 场景 3：你新增了摘要字段

比如数据库新增：

- `Excerpt`
  类型：`Rich text`

就需要在 Worker 中增加：

```js
excerpt: page.properties.Excerpt?.rich_text?.[0]?.plain_text ?? '',
```

### 场景 4：你新增了标签字段

比如数据库新增：

- `Tags`
  类型：`Multi-select`

则需要在 Worker 中增加：

```js
tags: page.properties.Tags?.multi_select?.map(tag => tag.name) ?? [],
```

### 总结一句话

Notion 数据库 property 一旦改名、删掉、换类型，`scripts/index.js` 里的 `page.properties.xxx` 就必须同步修改。  
否则 Worker 虽然还能跑，但返回的数据会缺字段、空字段，前端也就显示不出来。

## 当前网页是如何接入现有博客的

当前前端已经改成直接兼容这版 Worker：

- 首页请求 `/posts`
- 页面会把 `name` 当标题、`created_time` 当日期
- 点击文章后，请求 `/posts/:id`
- 前端把 Notion blocks 转成页面里的标题、段落和引用

也就是说，你现在 Notion 数据库里已有的页面条目，已经可以直接显示到网页上。

## 当前前端支持的正文 block

在 [app.js](/Users/lipeizhang/Downloads/code/vibe/Blog/app.js) 里，当前会把这些 block 渲染出来：

- `heading_1`
- `heading_2`
- `heading_3`
- `paragraph`
- `quote`
- `bulleted_list_item`
- `numbered_list_item`
- `callout`

未支持的 block 会被忽略。

## 如何测试 Worker 返回内容

已经有测试脚本：[scripts/test-worker.mjs](/Users/lipeizhang/Downloads/code/vibe/Blog/scripts/test-worker.mjs)

运行：

```bash
node scripts/test-worker.mjs https://你的-worker.workers.dev
```

它会：

1. 请求 `/posts`
2. 打印返回的文章列表
3. 自动取第一篇文章的 `id`
4. 再请求 `/posts/:id`
5. 打印正文 block 类型

## site.config.js 配置

前端 API 地址通过 [site.config.js](/Users/lipeizhang/Downloads/code/vibe/Blog/site.config.js) 配置：

```js
window.BLOG_CONFIG = {
  apiBase: ""
};
```

### 同域部署

如果网页和 Worker 在同一个域名下：

```js
window.BLOG_CONFIG = {
  apiBase: ""
};
```

### Worker 单独域名

如果 Worker 部署在：

```text
https://notion-proxy.nmnm7782525250.workers.dev
```

则配置成：

```js
window.BLOG_CONFIG = {
  apiBase: "https://notion-proxy.nmnm7782525250.workers.dev"
};
```

## Wrangler 入口

当前 [wrangler.jsonc](/Users/lipeizhang/Downloads/code/vibe/Blog/wrangler.jsonc) 已经改成：

```json
{
  "name": "blog-notion-worker",
  "main": "scripts/index.js",
  "compatibility_date": "2026-03-28"
}
```

也就是 Wrangler 实际部署的入口就是你现在这份 `scripts/index.js`。
