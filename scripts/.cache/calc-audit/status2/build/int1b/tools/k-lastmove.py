from patchlib import rep
rep("doubles-status.ts", "  const last = used ?? entry.lastMove ?? entry.carried?.encore?.move;",
    "  // A Pokémon under a carried Encore last used its Encore move (E2's ask 3, IN-TNT-02), when the input gives no last move\n  // (undefined: a null last move stays null).\n  const last = used ?? (entry.lastMove !== undefined ? entry.lastMove : entry.carried?.encore?.move);", "E2 ask 3 null-safe")
