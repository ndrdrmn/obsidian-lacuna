import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, existsSync, mkdirSync, watch } from "node:fs";

const production = process.argv[2] === "production";

// Production builds land in the repo root (what gets released).
// Dev builds go straight into the test vault's plugin folder.
const outDir = production ? "." : "test-vault/.obsidian/plugins/lacuna";

const copyStatic = {
  name: "copy-static",
  setup(build) {
    build.onEnd(() => {
      if (outDir === ".") return;
      mkdirSync(outDir, { recursive: true });
      for (const f of ["manifest.json", "styles.css"]) {
        if (existsSync(f)) copyFileSync(f, `${outDir}/${f}`);
      }
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  format: "cjs",
  target: "es2020",
  platform: "node",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: `${outDir}/main.js`,
  plugins: [copyStatic],
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
  // The watcher above follows the bundle's files only, so a change to styles.css alone never reached
  // the vault: copy it again whenever it changes.
  watch("styles.css", () => {
    try {
      copyFileSync("styles.css", `${outDir}/styles.css`);
    } catch {
      // an editor may have it locked for a moment; the next change copies it
    }
  });
}
