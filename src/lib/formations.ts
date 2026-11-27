import type { Formation, positionCodes } from "./types";
export const formations: Record<
  Formation,
  {
    label: (typeof positionCodes)[keyof typeof positionCodes];
    x: number;
    y: number;
  }[]
> = {
  "2-3-1": [
    { label: "GK", x: 50, y: 88 },
    { label: "LB", x: 28, y: 66 },
    { label: "RB", x: 72, y: 66 },
    { label: "LM", x: 18, y: 42 },
    { label: "CM", x: 50, y: 42 },
    { label: "RM", x: 82, y: 42 },
    { label: "ST", x: 50, y: 17 },
  ],
  "3-2-1": [
    { label: "GK", x: 50, y: 88 },
    { label: "LB", x: 18, y: 66 },
    { label: "CB", x: 50, y: 66 },
    { label: "RB", x: 82, y: 66 },
    { label: "LM", x: 30, y: 42 },
    { label: "RM", x: 70, y: 42 },
    { label: "ST", x: 50, y: 17 },
  ],
  "2-2-2": [
    { label: "GK", x: 50, y: 88 },
    { label: "LB", x: 28, y: 66 },
    { label: "RB", x: 72, y: 66 },
    { label: "LM", x: 28, y: 42 },
    { label: "RM", x: 72, y: 42 },
    { label: "LS", x: 28, y: 17 },
    { label: "RS", x: 72, y: 17 },
  ],
};
