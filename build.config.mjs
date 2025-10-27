import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: ["src/index.ts", "src/compiler.ts"],
  hooks: {
    rolldownConfig(config) {
      config.experimental ??= {};
      config.experimental.attachDebugInfo = "none";
    },
  },
});
