export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    // 统一的 Notion 请求头
    const notionHeaders = {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };

    // 解析 Tags 字段的统一方法，支持 | 和 , 分隔
    function parseTags(raw) {
      if (!raw) return [];
      return raw.split(/[|,]/).map(t => t.trim()).filter(Boolean);
    }

    // 将 Notion rich_text 数组转换为 Markdown 行内格式
    function richTextToMarkdown(items = []) {
      return items.map(item => {
        let text = item.plain_text || '';
        const ann = item.annotations || {};
        if (item.href) {
          // 过滤 javascript: 伪协议以防止 XSS
          const href = /^javascript:/i.test(item.href) ? '#' : item.href;
          text = `[${text}](${href})`;
        }
        if (ann.code) text = `\`${text}\``;
        if (ann.bold && ann.italic) text = `***${text}***`;
        else if (ann.bold) text = `**${text}**`;
        else if (ann.italic) text = `*${text}*`;
        if (ann.strikethrough) text = `~~${text}~~`;
        return text;
      }).join('');
    }

    // 将 Notion blocks 数组转换为 Markdown 字符串
    function blocksToMarkdown(blocks) {
      const parts = [];
      let inList = false;
      for (const block of blocks) {
        const type = block.type;
        const isList = type === 'bulleted_list_item' || type === 'numbered_list_item';
        let line;
        if (type === 'heading_1') {
          line = `# ${richTextToMarkdown(block.heading_1?.rich_text)}`;
        } else if (type === 'heading_2') {
          line = `## ${richTextToMarkdown(block.heading_2?.rich_text)}`;
        } else if (type === 'heading_3') {
          line = `### ${richTextToMarkdown(block.heading_3?.rich_text)}`;
        } else if (type === 'paragraph') {
          line = richTextToMarkdown(block.paragraph?.rich_text) || '';
        } else if (type === 'quote') {
          line = `> ${richTextToMarkdown(block.quote?.rich_text)}`;
        } else if (type === 'callout') {
          line = `> ${richTextToMarkdown(block.callout?.rich_text)}`;
        } else if (type === 'bulleted_list_item') {
          line = `- ${richTextToMarkdown(block.bulleted_list_item?.rich_text)}`;
        } else if (type === 'numbered_list_item') {
          line = `1. ${richTextToMarkdown(block.numbered_list_item?.rich_text)}`;
        } else if (type === 'code') {
          const lang = block.code?.language || '';
          line = `\`\`\`${lang}\n${richTextToMarkdown(block.code?.rich_text)}\n\`\`\``;
        } else if (type === 'divider') {
          line = '---';
        } else if (type === 'image') {
          const url = block.image?.external?.url || block.image?.file?.url || '';
          const caption = richTextToMarkdown(block.image?.caption);
          line = `![${caption || 'image'}](${url})`;
        } else {
          continue;
        }
        if (parts.length > 0) {
          parts.push(inList && isList ? '\n' : '\n\n');
        }
        parts.push(line);
        inList = isList;
      }
      return parts.join('');
    }

    // GET / → 健康检查
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        { headers: cors }
      );
    }

    // GET /db → 数据库名
    if (url.pathname === '/db') {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}`,
        { headers: notionHeaders }
      );
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data }), { status: 502, headers: cors });
      return new Response(
        JSON.stringify({ name: data.title?.[0]?.plain_text ?? '未命名' }),
        { headers: cors }
      );
    }

    // GET /posts?tag=关键字&category=分类 → 文章列表，支持过滤
    if (url.pathname === '/posts') {
      const filterTag = url.searchParams.get('tag') ?? '';
      const filterCategory = url.searchParams.get('category') ?? '';

      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`,
        {
          method: 'POST',
          headers: notionHeaders,
          body: JSON.stringify({
            sorts: [{ timestamp: 'created_time', direction: 'descending' }],
            page_size: 100,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data }), { status: 502, headers: cors });

      let posts = data.results.map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text ?? '无标题',
        created_time: page.created_time,
        category: page.properties.Category?.select?.name ?? '',
        tags: parseTags(page.properties.Tags?.rich_text?.[0]?.plain_text),
      }));

      if (filterTag) {
        posts = posts.filter(p =>
          p.tags.some(t => t.toLowerCase().includes(filterTag.toLowerCase()))
        );
      }
      if (filterCategory) {
        posts = posts.filter(p => p.category === filterCategory);
      }

      return new Response(JSON.stringify(posts), { headers: cors });
    }

    // GET /tags → 全部标签及出现频次
    if (url.pathname === '/tags') {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`,
        {
          method: 'POST',
          headers: notionHeaders,
          body: JSON.stringify({ page_size: 100 }),
        }
      );
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data }), { status: 502, headers: cors });

      const freq = {};
      for (const page of data.results) {
        const tags = parseTags(page.properties.Tags?.rich_text?.[0]?.plain_text);
        for (const tag of tags) {
          freq[tag] = (freq[tag] ?? 0) + 1;
        }
      }

      const sorted = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => ({ tag, count }));

      return new Response(JSON.stringify(sorted), { headers: cors });
    }

    // GET /graph → 知识图谱节点和边（标签共现关系）
    if (url.pathname === '/graph') {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`,
        {
          method: 'POST',
          headers: notionHeaders,
          body: JSON.stringify({ page_size: 100 }),
        }
      );
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data }), { status: 502, headers: cors });

      const freq = {};
      const coOccurrence = {};

      for (const page of data.results) {
        const tags = parseTags(page.properties.Tags?.rich_text?.[0]?.plain_text);
        for (const tag of tags) {
          freq[tag] = (freq[tag] ?? 0) + 1;
        }
        for (let i = 0; i < tags.length; i++) {
          for (let j = i + 1; j < tags.length; j++) {
            const key = [tags[i], tags[j]].sort().join('|||');
            coOccurrence[key] = (coOccurrence[key] ?? 0) + 1;
          }
        }
      }

      const nodes = Object.entries(freq).map(([id, weight]) => ({ id, weight }));
      const edges = Object.entries(coOccurrence).map(([key, weight]) => {
        const [source, target] = key.split('|||');
        return { source, target, weight };
      });

      return new Response(JSON.stringify({ nodes, edges }), { headers: cors });
    }

    // GET /posts/:id           → 仅 Markdown 正文
    // GET /posts/:id?full=true → 元数据 + Markdown 正文
    const match = url.pathname.match(/^\/posts\/(.+)$/);
    if (match) {
      const pageId = match[1];
      const full = url.searchParams.get('full') === 'true';

      if (!full) {
        const res = await fetch(
          `https://api.notion.com/v1/blocks/${pageId}/children`,
          { headers: notionHeaders }
        );
        const data = await res.json();
        if (!res.ok) return new Response(JSON.stringify({ error: data }), { status: 502, headers: cors });
        return new Response(JSON.stringify({ markdown: blocksToMarkdown(data.results) }), { headers: cors });
      }

      // full=true：并发请求元数据 + 正文块
      const [pageRes, blocksRes] = await Promise.all([
        fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders }),
        fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, { headers: notionHeaders }),
      ]);

      const [pageData, blocksData] = await Promise.all([
        pageRes.json(),
        blocksRes.json(),
      ]);

      if (!pageRes.ok) return new Response(JSON.stringify({ error: pageData }), { status: 502, headers: cors });
      if (!blocksRes.ok) return new Response(JSON.stringify({ error: blocksData }), { status: 502, headers: cors });

      return new Response(JSON.stringify({
        meta: {
          id: pageId,
          name: pageData.properties.Name?.title?.[0]?.plain_text ?? '无标题',
          created_time: pageData.created_time,
          category: pageData.properties.Category?.select?.name ?? '',
          tags: parseTags(pageData.properties.Tags?.rich_text?.[0]?.plain_text),
        },
        markdown: blocksToMarkdown(blocksData.results),
      }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: cors,
    });
  },
};