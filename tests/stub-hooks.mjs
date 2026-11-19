const STUB =
  'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') {
    return {
      url: 'data:text/javascript,' + encodeURIComponent(STUB),
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
