import { defineSOP } from "../../src/sop/define.js";
import { browser, fs, verify } from "../../src/sop/sdk.js";

export default defineSOP({
  name: "example",
  description: "访问 example.com，提取页面标题并保存到文件",

  async run(ctx) {
    // 步骤 1: 打开浏览器
    ctx.log("正在打开 example.com...");
    const tab = await browser.open("https://example.com");

    // 步骤 2: 获取页面快照并验证
    const snap = await browser.snapshot(tab.targetId);
    verify.notEmpty(snap.snapshot, "页面快照不应为空");

    // 步骤 3: 提取页面标题
    const title = await browser.evaluate(tab.targetId, "document.title");
    verify.notEmpty(title, "页面标题不应为空");
    ctx.log(`页面标题: ${title}`);

    // 步骤 4: 保存到文件
    const fileName = `/tmp/example_${ctx.date("YYYY-MM-DD")}.txt`;
    await fs.write(fileName, `Title: ${String(title)}\nCaptured at: ${ctx.date()}\n`);

    // 步骤 5: 验证文件存在
    await verify.fileExists(fileName);
    ctx.log(`已保存到 ${fileName}`);

    // 步骤 6: 关闭标签页
    await browser.close(tab.targetId);

    // 返回结果
    return { title, file: fileName };
  },
});
