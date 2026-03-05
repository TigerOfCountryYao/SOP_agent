
/**
 * SOP End-to-End Test Script
 *
 * Scenerio: "Daily Tech News Saver"
 * 1. Generate an SOP using LLM that opens Hacker News and saves the top story title.
 * 2. Verify the generated SOP file exists.
 * 3. Execute the SOP.
 * 4. Verify the output file content.
 */

import { generateSOP } from "../src/sop/generate.js";
import { runSOPByName } from "../src/sop/runner.js";
import fs from "node:fs";
import path from "node:path";
import { setBrowserOverride } from "../src/sop/sdk.js"; // Import the backdoor
import type { browser } from "../src/sop/sdk.js"; // Type for mock

const SOP_NAME = "daily-tech-news-saver";
const OUTPUT_FILE = "sops/daily_news.txt";

async function main() {
  console.log("🚀 Starting SOP E2E Test...");

  // Mock Browser setup
  console.log("🧩 Setting up Browser Mock...");
  const mockBrowser = {
      open: async (url: string) => {
          console.log(`[MockBrowser] Open: ${url}`);
          return { targetId: "mock-target-1" };
      },
      wait: async (targetId: string, opts: any) => {
          console.log(`[MockBrowser] Wait: ${JSON.stringify(opts)}`);
      },
      evaluate: async (targetId: string, js: string) => {
          console.log(`[MockBrowser] Evaluate: ${js.slice(0, 50)}...`);
          // Return a fake title if the JS looks like it's asking for one
          if (js.includes("textContent") || js.includes("title")) {
              return "Tech News: Artificial Intelligence Beats Human at Coding";
          }
          return null;
      },
      close: async (targetId: string) => {
           console.log(`[MockBrowser] Close: ${targetId}`);
      },
      // Stub other methods as needed, or cast as any/Partial
  } as unknown as typeof browser;
  
  setBrowserOverride(mockBrowser);

  // 1. Clean up previous run
  console.log("🧹 Cleaning up previous artifacts...");
  if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);
  // We don't delete the SOP dir to avoid re-generating every time if it exists,
  // but for a strict E2E we should. Let's force regeneration.
  const sopDir = path.join("sops", SOP_NAME);
  if (fs.existsSync(sopDir)) {
    fs.rmSync(sopDir, { recursive: true, force: true });
  }

  // 2. Generate SOP
  console.log("✨ Generating SOP...");
  await generateSOP({
    name: SOP_NAME,
    description: "Daily Tech News Saver - Auto generated",
    sopsDir: "sops",
    steps: [
      'Open "https://news.ycombinator.com/"',
      'Extract the text of the first story link (the top news title)',
      `Save this title to a file named "${OUTPUT_FILE}" in the workspace root`,
      'Log the title to the console'
    ],
    overwrite: true,
    // Provide a mock LLM to generate working code
    llmCall: async () => {
        // We return a code block string. Note: using simple concatenation to avoid nested backtick issues.
        return [
            '```typescript',
            'import { defineSOP, browser, fs } from "../../src/sop/index.js";',
            '',
            'export default defineSOP({',
            `  name: "${SOP_NAME}",`,
            '  description: "Get HN top story",',
            '  async run(ctx) {',
            '    ctx.log("Opening Hacker News...");',
            '    const { targetId } = await browser.open("https://news.ycombinator.com/");',
            '    ',
            '    // Wait for the title link',
            '    await browser.wait(targetId, { text: "Hacker News" });',
            '    ',
            '    // Extract title (simple selector approach or text extraction)',
            '    const title = await browser.evaluate(targetId, `',
            "        document.querySelector('.titleline > a')?.textContent || 'No Title Found'",
            '    `) as string;',
            '',
            '    ctx.log(`Top Story: "${title}"`);',
            '    ',
            `    fs.write("${OUTPUT_FILE}", title);`,
            '    ',
            '    await browser.close(targetId);',
            '    return { status: "ok" };',
            '  },',
            '});',
            '```'
        ].join("\n");
    }
  });

  // 3. Verify Generation
  const sopFile = path.join(sopDir, "sop.ts");
  if (!fs.existsSync(sopFile)) {
    console.error("❌ SOP generation failed: sop.ts not found.");
    process.exit(1);
  }
  console.log("✅ SOP generated successfully at:", sopFile);

  // 4. Execute SOP
  console.log("\n▶️ Executing SOP...");
  try {
    // runSOPByName(sopsDir, sopName, configDir, opts)
    // We use "sops" as sopsDir, and "." as configDir (for store)
    const result = await runSOPByName("sops", SOP_NAME, ".", {});
    console.log("✅ Execution finished with status:", result.status);

    if (result.status !== "ok") {
        console.error("❌ SOP execution reported failure:", result.error);
        process.exit(1);
    }
  } catch (err) {
    console.error("❌ Execution threw error:", err);
    process.exit(1);
  }

  // 5. Verify Output
  console.log("\n🔍 Verifying output file...");
  if (!fs.existsSync(OUTPUT_FILE)) {
    console.error(`❌ Output file "${OUTPUT_FILE}" was NOT created.`);
    process.exit(1);
  }

  const content = fs.readFileSync(OUTPUT_FILE, "utf-8").trim();
  console.log(`📄 File content: "${content}"`);

  if (content.length > 0) {
    console.log("✅ Test PASSED: Content successfully saved!");
  } else {
    console.error("❌ Test FAILED: Output file is empty.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Unhandled test error:", err);
  process.exit(1);
});
