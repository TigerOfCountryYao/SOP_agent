import { defineSOP, browser, fs } from "../../src/sop/index.js";

export default defineSOP({
  name: "daily-tech-news-saver",
  description: "Get HN top story",
  async run(ctx) {
    ctx.log("Opening Hacker News...");
    const { targetId } = await browser.open("https://news.ycombinator.com/");
    
    // Wait for the title link
    await browser.wait(targetId, { text: "Hacker News" });
    
    // Extract title (simple selector approach or text extraction)
    const title = await browser.evaluate(targetId, `
        document.querySelector('.titleline > a')?.textContent || 'No Title Found'
    `) as string;

    ctx.log(`Top Story: "${title}"`);
    
    fs.write("sops/daily_news.txt", title);
    
    await browser.close(targetId);
    return { status: "ok" };
  },
});