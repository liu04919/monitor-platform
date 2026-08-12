import crashLoop from "./crashLoop";
import stutterLoop from "./stutterLoop";
import whiteScreenLoop from "./whiteScreenLoop";
import type { MonitorPlugin } from "../types";

export const whiteScreenPlugin = (): MonitorPlugin => ({
  name: "stability:white-screen",
  setup: whiteScreenLoop,
});

export const stutterPlugin = (): MonitorPlugin => ({
  name: "stability:stutter",
  setup: stutterLoop,
});

export const crashPlugin = (): MonitorPlugin => ({
  name: "stability:crash",
  setup: crashLoop,
});

export const stabilityPlugins = (): MonitorPlugin[] => [
  whiteScreenPlugin(),
  stutterPlugin(),
  crashPlugin(),
];
