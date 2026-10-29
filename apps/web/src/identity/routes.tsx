import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRoute,
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { rootRoute } from "../shell.js";
import { NavigationIcon } from "../navigation-icon.js";
import { logout, sessionQuery } from "./api.js";
import { loginErrorReasons, type LoginErrorReason } from "./messages.js";
import {
  SessionsPage,
  SignInPage,
  useIdentityMessages,
  WelcomeTwoStepPage,
} from "./pages.js";
import "./identity.css";

/** A same-origin panel path, or nothing. */
function panelPath(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^\/(?![/\\])/.test(value) &&
    value.length <= 2048
    ? value
    : undefined;
}

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    error?: LoginErrorReason | undefined;
    returnTo?: string | undefined;
  } => ({
    // Explicit undefined values replace invalid raw search parameters, which
    // the router would otherwise keep.
    error: loginErrorReasons.includes(search.error as LoginErrorReason)
      ? (search.error as LoginErrorReason)
      : undefined,
    returnTo: panelPath(search.returnTo),
  }),
  component: function SignInRoute() {
    const search = signInRoute.useSearch();
    return <SignInPage {...search} />;
  },
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/sessions",
  component: SessionsPage,
});

// The API sends a new person here after their first sign-in.
const welcomeTwoStepRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome/two-step",
  validateSearch: (
    search: Record<string, unknown>,
  ): { returnTo?: string | undefined } => ({
    returnTo: panelPath(search.returnTo),
  }),
  component: function WelcomeTwoStepRoute() {
    const { returnTo } = welcomeTwoStepRoute.useSearch();
    return <WelcomeTwoStepPage returnTo={returnTo ?? "/"} />;
  },
});

export const identityRoutes = [
  signInRoute,
  sessionsRoute,
  welcomeTwoStepRoute,
] as const;

/** Header and home-page entry: sign in, or reach sessions and sign out. */
export function IdentityNavigation() {
  const { locale, t } = useIdentityMessages();
  // The documentation portal makes no API calls while browsing, so the
  // session is neither queried nor shown there.
  const isDocumentation = useRouterState({
    select: (state) =>
      state.location.pathname === "/docs" ||
      state.location.pathname.startsWith("/docs/"),
  });
  const session = useQuery({ ...sessionQuery, enabled: !isDocumentation });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: async () => {
      // Never keep protected data cached across a sign-out attempt.
      queryClient.clear();
      await navigate({ to: "/sign-in" });
    },
  });
  if (isDocumentation) return null;
  if (!session.data)
    return (
      <Link to="/sign-in" lang={locale}>
        <NavigationIcon name="signIn" />
        {t.navSignIn}
      </Link>
    );
  return (
    <span className="identity-nav" lang={locale}>
      <Link to="/account/sessions">
        <NavigationIcon name="sessions" />
        {t.navSessions}
      </Link>
      <button
        type="button"
        className="button-text"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
      >
        <NavigationIcon name="signOut" />
        {signOut.isPending ? t.signingOut : t.navSignOut}
      </button>
    </span>
  );
}
