/**
 * Arbres de comportement minimalistes, sans état : l'arbre est réévalué à chaque pas.
 * Utilisés par l'IA tactique (comportements élémentaires des unités).
 */
export type BtStatus = 'success' | 'failure';
export type BtNode<C> = (ctx: C) => BtStatus;

/** Réussit dès qu'un enfant réussit (priorité à gauche). */
export function selector<C>(...nodes: BtNode<C>[]): BtNode<C> {
  return (ctx) => {
    for (const node of nodes) if (node(ctx) === 'success') return 'success';
    return 'failure';
  };
}

/** Réussit si tous les enfants réussissent, dans l'ordre. */
export function sequence<C>(...nodes: BtNode<C>[]): BtNode<C> {
  return (ctx) => {
    for (const node of nodes) if (node(ctx) === 'failure') return 'failure';
    return 'success';
  };
}

export function condition<C>(predicate: (ctx: C) => boolean): BtNode<C> {
  return (ctx) => (predicate(ctx) ? 'success' : 'failure');
}

export function action<C>(effect: (ctx: C) => void): BtNode<C> {
  return (ctx) => {
    effect(ctx);
    return 'success';
  };
}
