import { defineSOP, shell, fs, verify } from "../../src/sop/index.js";

export default defineSOP({
  name: "e2e-real-shell",
  description: "Fetch real HN page via shell and persist top title",
  async run(ctx) {
    ctx.log("Fetching Hacker News homepage via shell...");
    const result = await shell.run("curl -sL https://news.ycombinator.com/");
    if (result.exitCode !== 0) {
      ctx.abort(`curl failed: ${result.stderr || result.stdout}`);
    }

    const html = result.stdout || "";
    verify.notEmpty(html, "Empty response from news.ycombinator.com");

    const match = html.match(/<span class=\"titleline\"><a[^>]*>(.*?)<\/a>/i);
    const topTitle = (match?.[1] || "").replace(/<[^>]+>/g, "").trim();
    verify.notEmpty(topTitle, "Could not extract top title from HTML");

    const outPath = "sops/daily_news_real.txt";
    await fs.write(outPath, `${topTitle}\n`);
    await verify.fileExists(outPath);

    ctx.log(`Top title saved: ${topTitle}`);
    return { topTitle, outPath };
  },
});
