// Groups imports as external (Node built-ins, packages) then internal (relative paths, project
// aliases), one blank line between, each group sorted by module path length then A-Z.
// Side-effect imports (`import "x"`) are barriers: they keep their place and each run of imports
// between them is sorted on its own.
const compare = (a, b) => a.source.length - b.source.length || a.source.localeCompare(b.source);

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [
      {
        type: "object",
        properties: { aliases: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      order:
        "Imports must be grouped external then internal (one blank line between), sorted by module path length, then A-Z.",
    },
  },
  create(context) {
    const aliases = new Set(context.options[0]?.aliases ?? []);
    const sourceCode = context.sourceCode;
    const isInternal = (source) =>
      source.startsWith(".") ||
      source.startsWith("@/") ||
      source.startsWith("~/") ||
      aliases.has(source.split("/")[0]);

    function check(run) {
      const first = run[0];
      const items = run.map((node, i) => {
        // own-line comments above an import travel with it, except a file header above the first one
        const comments =
          i === 0
            ? []
            : sourceCode
                .getCommentsBefore(node)
                .filter((c) => c.loc.start.line > run[i - 1].loc.end.line);
        const start = comments.length ? comments[0].range[0] : node.range[0];
        let end = node.range[1];
        for (const c of sourceCode.getCommentsAfter(node)) {
          if (c.loc.start.line !== node.loc.end.line) break;
          end = c.range[1];
        }
        return {
          end,
          source: node.source.value,
          text: sourceCode.text.slice(start, end),
          internal: isInternal(node.source.value),
        };
      });
      const sorted = [...items].sort(compare);
      const external = sorted.filter((i) => !i.internal).map((i) => i.text);
      const internal = sorted.filter((i) => i.internal).map((i) => i.text);
      const expected = [external.join("\n"), internal.join("\n")].filter(Boolean).join("\n\n");
      const range = [first.range[0], items[items.length - 1].end];
      if (sourceCode.text.slice(...range) === expected) return;
      context.report({
        node: first,
        messageId: "order",
        fix: (fixer) => fixer.replaceTextRange(range, expected),
      });
    }

    return {
      Program(program) {
        let run = [];
        for (const node of program.body) {
          if (node.type !== "ImportDeclaration") break;
          if (node.specifiers.length === 0) {
            if (run.length) check(run);
            run = [];
          } else run.push(node);
        }
        if (run.length) check(run);
      },
    };
  },
};
