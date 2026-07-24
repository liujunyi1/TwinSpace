import { describe, expect, it } from "vitest";
import {
  findSimulatedPersonaByUsername,
  simulatedPersonas
} from "@/lib/simulation/personas";
import {
  buildSimulatedComment,
  buildSimulatedDirectReply
} from "@/lib/simulation/generator";

describe("simulated personas", () => {
  it("defines 15 complete fixture users", () => {
    expect(simulatedPersonas).toHaveLength(15);
    const usernames = new Set(simulatedPersonas.map((persona) => persona.username));
    const emails = new Set(simulatedPersonas.map((persona) => persona.email));
    expect(usernames.size).toBe(15);
    expect(emails.size).toBe(15);

    for (const persona of simulatedPersonas) {
      expect(persona.username).toMatch(/^sim_/);
      expect(persona.nickname).not.toHaveLength(0);
      expect(persona.summary).not.toHaveLength(0);
      expect(persona.posts.length).toBeGreaterThanOrEqual(2);
      expect(persona.memories.length).toBeGreaterThanOrEqual(2);
      expect(persona.knowledge.length).toBeGreaterThanOrEqual(1);
      expect(persona.commentStyle).not.toHaveLength(0);
      expect(persona.dmStyle).not.toHaveLength(0);
    }
  });

  it("can look personas up by username", () => {
    expect(findSimulatedPersonaByUsername("sim_chenxi")?.key).toBe("kaoyan_chenxi");
    expect(findSimulatedPersonaByUsername("demo")).toBeNull();
  });

  it("generates deterministic comments and direct replies", () => {
    const persona = simulatedPersonas[0];
    const comment = buildSimulatedComment(persona, {
      id: "post-1",
      content: "今天把任务拆小以后轻松了一点。",
      topicsJson: JSON.stringify(["学习", "日常"]),
      author: { nickname: "用户" }
    });
    const repeatedComment = buildSimulatedComment(persona, {
      id: "post-1",
      content: "今天把任务拆小以后轻松了一点。",
      topicsJson: JSON.stringify(["学习", "日常"]),
      author: { nickname: "用户" }
    });
    const reply = buildSimulatedDirectReply(persona, {
      id: "message-1",
      content: "我今天有点焦虑。",
      sender: { nickname: "用户" }
    });

    expect(comment).toBe(repeatedComment);
    expect(comment.length).toBeGreaterThan(8);
    expect(reply).toContain(persona.dmStyle);
  });
});
