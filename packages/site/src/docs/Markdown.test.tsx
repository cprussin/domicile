import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "./Markdown";

const PAGES = [{ slug: "manganese/idle", source: "docs/IDLE.md" }];

const render = (source: string) =>
  renderToStaticMarkup(
    <Markdown from="docs/LOCK.md" pages={PAGES} source={source} />,
  );

describe("Markdown", () => {
  test("headings carry GitHub's ids", () => {
    expect(render("# The lock\n\n## Sleep and logind")).toMatch(
      /<h2[^>]*id="sleep-and-logind"/,
    );
  });

  test("links go where the site serves them", () => {
    const html = render(
      "See [idle](IDLE.md#clocks) and [the source](../src/).",
    );
    expect(html).toContain('href="/docs/manganese/idle#clocks"');
    expect(html).toContain(
      'href="https://github.com/cprussin/domicile/blob/stable/src/"',
    );
  });

  test("inline text keeps its emphasis and code", () => {
    expect(render("**Meta+L** locks, *now*, with `lock`.")).toMatch(
      /<strong[^>]*>Meta\+L<\/strong> locks, <em[^>]*>now<\/em>, with <code[^>]*>lock<\/code>\./,
    );
  });

  test("code blocks are highlighted in their language", () => {
    const html = render("```ts\nconst a = 1;\n```");
    expect(html).toContain("<pre");
    expect(html).toContain(">const<");
  });

  test("a code block in an unknown language is plain", () => {
    expect(render("```nix\n{ a = 1; }\n```")).toContain(">{ a = 1; }<");
  });

  test("lists keep their order and start", () => {
    const html = render("3. three\n4. four\n\n- a\n- b");
    expect(html).toMatch(/<ol[^>]*start="3"/);
    expect(html).toMatch(/<ul[^>]*><li[^>]*>a<\/li><li[^>]*>b<\/li><\/ul>/);
  });

  test("tables have a head, a body and alignment", () => {
    const html = render("| Key | Does |\n|:--|--:|\n| `a` | b |");
    expect(html).toMatch(/<thead[^>]*><tr[^>]*><th[^>]*>Key<\/th>/);
    expect(html).toMatch(/<td[^>]*data-align="right"[^>]*>b<\/td>/);
  });

  test("quotes and rules", () => {
    const html = render("> careful\n\n---");
    expect(html).toMatch(/<blockquote[^>]*><p[^>]*>careful<\/p><\/blockquote>/);
    expect(html).toContain("<hr");
  });
});
