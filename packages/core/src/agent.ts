import { LLMProvider } from "./llm/provider";

export class DevOpsAgent {
  constructor(
    private provider: LLMProvider,
    private systemPrompt = "You are an expert DevOps engineer.",
  ) {}

  async run(prompt: string) {
    return this.provider.generate({
      system: this.systemPrompt,
      prompt,
    });
  }
}
