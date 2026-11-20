import { Plugin } from "obsidian";

export default class LacunaPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("Lacuna loaded");
  }

  onunload(): void {
    console.log("Lacuna unloaded");
  }
}
