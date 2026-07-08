import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True only after client-side hydration. Uses useSyncExternalStore (not
 * useState+useEffect) so React handles the server/client snapshot mismatch
 * natively instead of via a post-mount setState.
 */
export function useHasMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
