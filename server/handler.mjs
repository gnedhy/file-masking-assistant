import { createOperationsHandler } from "./operations-app.mjs";
import { createVaultHandler } from "./app.mjs";
import { createFeedbackHandler } from "./feedback.mjs";

// One service, one session: access and operation routes answer first and hand everything else to the Vault routes.
// `access` wraps the sign-in provider, so every handler sees isAdmin from the admin list.
export function createAppHandler({ vaultRepository, operationsRepository, feedbackRepository, access, origin }) {
  const operations = createOperationsHandler({ repository: operationsRepository, auth: access, origin });
  const vault = createVaultHandler({ repository: vaultRepository, auth: access });
  const feedback = feedbackRepository ? createFeedbackHandler({ repository: feedbackRepository, auth: access, origin }) : async () => null;
  return async request => {
    if (new URL(request.url).pathname === "/api/v1/session") await access.claimFirst(request);
    return (await access.handle(request)) ?? (await feedback(request)) ?? (await operations(request)) ?? vault(request);
  };
}
