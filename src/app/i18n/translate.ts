import React from "react";
import type { TFunction } from "i18next";

export const translateChildren = (
  children: React.ReactNode,
  t: TFunction
): React.ReactNode => {
  return React.Children.map(children, (child): React.ReactNode => {
    if (typeof child === "string") {
      return t(child);
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props?.children) {
      return React.cloneElement(child, {
        children: translateChildren(child.props.children, t),
      } as { children?: React.ReactNode });
    }
    return child;
  });
};
