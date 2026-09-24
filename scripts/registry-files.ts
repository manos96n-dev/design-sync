import { readdir } from "node:fs/promises";
export async function registryFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const distributable = entries.filter(
    (entry) =>
      !entry.isSymbolicLink() &&
      entry.name !== "node_modules" &&
      !(
        entry.name === ".env" ||
        (entry.name.startsWith(".env.") && entry.name !== ".env.example")
      ),
  );
  return (
    await Promise.all(
      distributable.map((entry) =>
        entry.isDirectory()
          ? registryFiles(`${directory}/${entry.name}`)
          : Promise.resolve([`${directory}/${entry.name}`]),
      ),
    )
  )
    .flat()
    .sort();
}
