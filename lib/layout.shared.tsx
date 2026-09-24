import { Code2, RefreshCw } from "lucide-react";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-fd-primary text-fd-primary-foreground">
            <RefreshCw className="size-4" strokeWidth={2.25} />
          </span>
          Design Sync
        </span>
      ),
    },
    githubUrl: "https://github.com/manos96n-dev/design-sync",
    links: [
      {
        text: "Registry item",
        url: "/r/design-sync.json",
        secondary: true,
      },
      {
        icon: <Code2 />,
        text: "Source",
        url: "https://github.com/manos96n-dev/design-sync",
        secondary: true,
      },
    ],
  };
}
