import { expect, it } from "vitest";
import { findTextMatches } from "../chat/tools/documentOps";

const find = (text: string, query: string) =>
  findTextMatches({ text, query, maxResults: 20, contextChars: 20 });

it("treats double quotes as separators only for unquoted queries", () => {
  expect(find('"Affiliate" means', "Affiliate means").totalMatches).toBe(1);
  expect(find("“Affiliate” means", '"Affiliate" means').totalMatches).toBe(1);
  expect(find('A"XB', "AXB").totalMatches).toBe(0);
  expect(find('"Affiliate"', "Affiliate").hits[0]?.excerpt).toBe("Affiliate");
});
