import { Link } from "@tanstack/react-router";
import { useModuleNavigation } from "./module-navigation.js";

export function HomePage() {
  const navigation = useModuleNavigation();
  return (
    <section className="panel home-panel" aria-labelledby="home-title">
      <p className="eyebrow">Application</p>
      <h1 id="home-title">{__PROJECT_NAME__}</h1>
      {navigation.length > 0 ? (
        <>
          <p>Choose a workspace to continue.</p>
          <nav aria-label="Workspaces" className="home-links">
            {navigation.map((Item, index) => (
              <Item key={index} />
            ))}
          </nav>
        </>
      ) : (
        <p>
          No product workflows exist yet. Compose new modules in{" "}
          <code>apps/web/src/modules.tsx</code> and{" "}
          <code>apps/api/src/modules.ts</code>.
        </p>
      )}
      {__ORION_INTERNAL_DOCS__ && (
        <p>
          <Link to="/docs">Read the living documentation</Link>
        </p>
      )}
    </section>
  );
}
