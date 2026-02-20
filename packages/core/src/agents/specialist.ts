import { LLMProvider, LLMRequest, LLMResponse } from "../llm/provider";

export interface SpecialistConfig {
  name: string;
  domain: string;
  systemPrompt: string;
  keywords: string[];
}

export class SpecialistAgent {
  constructor(
    private provider: LLMProvider,
    private config: SpecialistConfig,
  ) {}

  get name(): string {
    return this.config.name;
  }

  get domain(): string {
    return this.config.domain;
  }

  get keywords(): string[] {
    return this.config.keywords;
  }

  async run(request: Omit<LLMRequest, "system">): Promise<LLMResponse> {
    return this.provider.generate({
      ...request,
      system: this.config.systemPrompt,
    });
  }
}
