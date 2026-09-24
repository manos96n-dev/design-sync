import { loader } from "fumadocs-core/source";
import { slugsPlugin } from "fumadocs-core/source/plugins/slugs";
import { defineDocs } from "fumadocs-mdx/macro";

const docs = defineDocs({
  dir: "docs/design-sync",
});

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [
    slugsPlugin((file, next) =>
      file.path.toLowerCase() === "readme.md" ? [] : next(),
    ),
  ],
});
