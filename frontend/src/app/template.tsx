import React from "react";
import ForestTransition from "@/components/ForestTransition";

export default function Template({ children }: { children: React.ReactNode }) {
  return <ForestTransition>{children}</ForestTransition>;
}
