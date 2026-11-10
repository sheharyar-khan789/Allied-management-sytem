// @ts-ignore
async function runClaudeCode() {
  const baseURL = process.env.ANTHROPIC_BASE_URL || "http://localhost:11434";
  const model = process.env.ANTHROPIC_MODEL || "qwen2.5-coder:7b";

  console.log(`🤖 Claude Code Running...\n`);
  console.log(`Using: ${baseURL}`);
  console.log(`Model: ${model}\n`);

  try {
    const response = await fetch(`${baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content:
              "Namaste! Tu Allied School Management System ke baare mein kuch interesting batao.",
          },
        ],
        max_tokens: 1024,
      }),
    });

    const data = await response.json();
    console.log("Response:", JSON.stringify(data, null, 2));

    if (data.content && data.content[0]) {
      console.log("\n✅ Claude's Response:");
      console.log(data.content[0].text);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

runClaudeCode();
