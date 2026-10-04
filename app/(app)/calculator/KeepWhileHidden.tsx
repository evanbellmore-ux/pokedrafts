"use client";

import { memo, type ReactNode } from "react";

type Props = {
  /** The region's view is shown. */
  active: boolean;
  /** The region's markup; called only when the region renders. */
  render: () => ReactNode;
};

function Region({ render }: Props) {
  return render();
}

/**
 * A 1v1-only or 2v2-only region (data-calculator-mode-only). It renders once when its view is hidden (its markup then
 * carries `hidden`) and again on every update while shown. Between those, updates skip it: the hidden markup stays
 * mounted with its state, and nothing in `render` runs.
 */
const KeepWhileHidden = memo(Region, (previous, next) => !previous.active && !next.active);

export default KeepWhileHidden;
