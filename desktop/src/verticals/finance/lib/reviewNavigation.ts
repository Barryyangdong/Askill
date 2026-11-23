interface ReviewRouteState {
  inboxReturn?: { source?: string; key?: string };
}

export function reviewNavigation(pathname: string, search: string, state?: ReviewRouteState | null, options?: {
  theme?: string; focusVerifyPlan?: boolean; day?: string | null;
}) {
  const params = new URLSearchParams(search);
  const keepInboxReturn = Boolean(params.get("reminder"))
    && state?.inboxReturn?.source === "inbox-message" && typeof state.inboxReturn.key === "string";
  for (const key of ["themeView", "theme", "themeId", "sampleDate"]) params.delete(key);
  if (pathname === "/shortline/themes" && options?.theme) params.set("theme", options.theme);
  if (options?.focusVerifyPlan && options.day) params.set("date", options.day);
  return {
    to: { pathname, search: params.size ? `?${params}` : "" },
    replace: keepInboxReturn,
    state: options?.focusVerifyPlan ? { ...(keepInboxReturn ? state : {}), focusVerifyPlan: true } : keepInboxReturn ? state : undefined,
  };
}
