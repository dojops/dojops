import { LLMProvider } from "./llm/provider";
import { sanitizeUserInput } from "./llm/sanitizer";

export class DevOpsAgent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly systemPrompt = "You are an expert DevOps engineer.",
  ) {}

  async run(prompt: string) {
    return this.provider.generate({
      system: this.systemPrompt,
      prompt: sanitizeUserInput(prompt),
    });
  }
}
