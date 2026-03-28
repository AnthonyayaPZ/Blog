const baseUrl = (process.argv[2] || "https://notion-proxy.nmnm7782525250.workers.dev").replace(/\/$/, "");

async function fetchJson(path) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    url,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type") || "",
    data
  };
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function summarizePosts(posts) {
  if (!Array.isArray(posts)) {
    console.log("返回内容不是数组：");
    console.log(posts);
    return null;
  }

  console.log(`共返回 ${posts.length} 篇文章`);

  posts.slice(0, 5).forEach((post, index) => {
    console.log(`\n[${index + 1}] ${post.title || "无标题"}`);
    console.log(`id: ${post.id || "(none)"}`);
    console.log(`category: ${post.category || "(none)"}`);
    console.log(`date: ${post.date || "(none)"}`);
    console.log(`tags: ${Array.isArray(post.tags) ? post.tags.join(", ") : "(none)"}`);
    console.log(`excerpt: ${post.excerpt || "(none)"}`);
  });

  return posts[0]?.id || null;
}

function summarizeBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    console.log("返回内容不是数组：");
    console.log(blocks);
    return;
  }

  console.log(`共返回 ${blocks.length} 个 block`);

  blocks.slice(0, 10).forEach((block, index) => {
    console.log(`\n[${index + 1}] type=${block.type}`);
    console.log(`id=${block.id}`);
  });
}

async function main() {
  printSection("测试 /posts");
  const postsResult = await fetchJson("/posts");
  console.log(`URL: ${postsResult.url}`);
  console.log(`Status: ${postsResult.status} ${postsResult.statusText}`);
  console.log(`Content-Type: ${postsResult.contentType}`);

  if (postsResult.status !== 200) {
    console.log("响应内容：");
    console.log(postsResult.data);
    return;
  }

  const firstPostId = summarizePosts(postsResult.data);

  if (!firstPostId) {
    console.log("\n没有可用于继续测试的文章 id。");
    return;
  }

  printSection(`测试 /posts/${firstPostId}`);
  const detailResult = await fetchJson(`/posts/${firstPostId}`);
  console.log(`URL: ${detailResult.url}`);
  console.log(`Status: ${detailResult.status} ${detailResult.statusText}`);
  console.log(`Content-Type: ${detailResult.contentType}`);

  if (detailResult.status !== 200) {
    console.log("响应内容：");
    console.log(detailResult.data);
    return;
  }

  summarizeBlocks(detailResult.data);
}

main().catch((error) => {
  console.error("\n测试失败：", error.message);
  process.exitCode = 1;
});
