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

    // GET / → 健康检查
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        { headers: cors }
      );
    }

    // GET /db → 获取数据库自身的名字
    if (url.pathname === '/db') {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${env.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
          },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data }), { status: 502, headers: cors });
      }
      // 数据库名字在 title 数组里
      const dbName = data.title?.[0]?.plain_text ?? '未命名数据库';
      return new Response(JSON.stringify({ name: dbName }), { headers: cors });
    }

    // GET /posts → 获取所有条目的名字 + 创建日期
    if (url.pathname === '/posts') {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sorts: [{ timestamp: 'created_time', direction: 'descending' }],
            page_size: 100,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data }), { status: 502, headers: cors });
      }

      const posts = data.results.map(page => ({
        id: page.id,
        // ↓ 对应你的 Name 字段（Title 类型）
        name: page.properties.Name?.title?.[0]?.plain_text ?? '无标题',
        // ↓ Created time 是系统字段，从顶层取
        created_time: page.created_time,
      }));

      return new Response(JSON.stringify(posts), { headers: cors });
    }

    // GET /posts/:id → 获取单篇正文块
    const match = url.pathname.match(/^\/posts\/(.+)$/);
    if (match) {
      const res = await fetch(
        `https://api.notion.com/v1/blocks/${match[1]}/children`,
        {
          headers: {
            'Authorization': `Bearer ${env.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
          },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data }), { status: 502, headers: cors });
      }
      return new Response(JSON.stringify(data.results), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: cors,
    });
  },
};