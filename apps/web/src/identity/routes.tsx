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
import { SessionsPage, SignInPage, useIdentityMessages } from "./pages.js";
import "./identity.css";

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (
    search: Record<string, unknown>,
  ): { error?: LoginErrorReason; returnTo?: string } => ({
    ...(loginErrorReasons.includes(search.error as LoginErrorReason)
      ? { error: search.error as LoginErrorReason }
      : {}),
    ...(typeof search.returnTo === "string" &&
    /^\/(?![/\\])/.test(search.returnTo) &&
    search.returnTo.length <= 2048
      ? { returnTo: search.returnTo }
      : {}),
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

export const identityRoutes = [signInRoute, sessionsRoute] as const;

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
