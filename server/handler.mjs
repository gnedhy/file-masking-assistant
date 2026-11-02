import { createOperationsHandler } from "./operations-app.mjs";
import { createVaultHandler } from "./app.mjs";

// One service, one session: operation routes answer first and hand everything else to the Vault routes.
export function createAppHandler({ vaultRepository, operationsRepository, auth, origin }) {
  const operations = createOperationsHandler({ repository: operationsRepository, auth, origin });
  const vault = createVaultHandler({ repository: vaultRepository, auth });
  return async request => (await operations(request)) ?? vault(request);
}
