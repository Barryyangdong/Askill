import { createContext, useContext } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { workspaceHref, type WorkspaceContext } from "@/lib/workspaceContext";
export const WorkspaceContextScope = createContext<WorkspaceContext>({});
export function WorkspaceLink(props: LinkProps) {
  const context = useContext(WorkspaceContextScope);
  return <Link {...props} to={typeof props.to === "string" ? workspaceHref(props.to, context) : props.to} />;
}
