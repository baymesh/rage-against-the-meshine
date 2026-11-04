import { escapeMaskedLinks, sanitizeLinkLabel } from "../src/MarkdownUtils";

describe("escapeMaskedLinks", () => {
  it("neutralises a masked link", () => {
    expect(escapeMaskedLinks("[meshview](https://evil.example)")).toBe(
      "\\[meshview](https://evil.example)",
    );
  });

  it("neutralises every masked link on a line, not just the first", () => {
    expect(
      escapeMaskedLinks("[a](https://x.example) and [b](https://y.example)"),
    ).toBe("\\[a](https://x.example) and \\[b](https://y.example)");
  });

  it("handles nested brackets and angle-bracket urls", () => {
    expect(escapeMaskedLinks("[[a](https://x.example)]")).toBe(
      "\\[\\[a](https://x.example)]",
    );
    expect(escapeMaskedLinks("[a](<https://x.example>)")).toBe(
      "\\[a](<https://x.example>)",
    );
  });

  it("leaves bare urls and ordinary brackets alone", () => {
    const plain = "see https://meshview.bayme.sh/packet/1 [KD6] (done)";
    expect(escapeMaskedLinks(plain)).toBe(plain);
    expect(escapeMaskedLinks("[not a link] (text)")).toBe(
      "[not a link] (text)",
    );
    expect(escapeMaskedLinks("")).toBe("");
  });
});

describe("sanitizeLinkLabel", () => {
  it("stops a label from closing the link early", () => {
    expect(sanitizeLinkLabel("x](https://evil.example) [")).toBe(
      "x)(https://evil.example) (",
    );
  });

  it("keeps normal short names unchanged", () => {
    expect(sanitizeLinkLabel("BCR1")).toBe("BCR1");
    expect(sanitizeLinkLabel("🏔️")).toBe("🏔️");
  });

  it("returns an empty string for non-string input", () => {
    expect(sanitizeLinkLabel(undefined as any)).toBe("");
  });
});
