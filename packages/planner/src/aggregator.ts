/**
 * ResultAggregator — combines outputs from parallel tasks in a wave.
 *
 * Uses pattern-matching rules to group task results and apply
 * merge/concat/best-of strategies.
 */

export type AggregationStrategy = "merge" | "concat" | "best";

export interface AggregationRule {
  /** Regex matching task IDs to aggregate. */
  pattern: RegExp;
  strategy: AggregationStrategy;
  /** For "best" strategy: key in output to compare (default: "score"). */
  scoreKey?: string;
}

export class ResultAggregator {
  constructor(private readonly rules: AggregationRule[] = []) {}

  /** Aggregate results from a completed wave. Returns combined outputs keyed by pattern source. */
  aggregate(results: Array<{ taskId: string; output: unknown }>): Map<string, unknown> {
    const groups = new Map<string, Array<{ taskId: string; output: unknown }>>();

    for (const result of results) {
      for (const rule of this.rules) {
        if (rule.pattern.test(result.taskId)) {
          const groupKey = rule.pattern.source;
          if (!groups.has(groupKey)) groups.set(groupKey, []);
          groups.get(groupKey)!.push(result);
          break; // first matching rule wins
        }
      }
    }

    const aggregated = new Map<string, unknown>();
    for (const [groupKey, items] of groups) {
      const rule = this.rules.find((r) => r.pattern.source === groupKey)!;
      switch (rule.strategy) {
        case "merge":
          aggregated.set(groupKey, Object.assign({}, ...items.map((i) => i.output)));
          break;
        case "concat":
          aggregated.set(
            groupKey,
            items.map((i) => i.output),
          );
          break;
        case "best": {
          const scoreField = rule.scoreKey ?? "score";
          const best = items.reduce((a, b) => {
            const aScore = (a.output as Record<string, number>)?.[scoreField] ?? 0;
            const bScore = (b.output as Record<string, number>)?.[scoreField] ?? 0;
            return aScore >= bScore ? a : b;
          });
          aggregated.set(groupKey, best.output);
          break;
        }
      }
    }

    return aggregated;
  }
}
