/**
 * Volitelné secrety, které nejsou ve `wrangler.jsonc` (a být tam nesmějí).
 * `wrangler types` je nevygeneruje, tak se dodeklarují tady — rozhraní `Env`
 * se slučuje s tím ze `worker-configuration.d.ts`.
 */
interface Env {
  /**
   * Klíč ke Claude. **Nepovinný** — bez něj jede jen free backend
   * (Cloudflare Workers AI) a appka sama od sebe nikdy neutrácí.
   * Nastavuje se `npx wrangler secret put ANTHROPIC_API_KEY`.
   */
  ANTHROPIC_API_KEY?: string;
}
