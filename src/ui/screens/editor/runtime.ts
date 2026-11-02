// The live viewport + interaction of the open editor (one at a time), for panels that need to start a drag,
// frame the camera or take a snapshot.
import type { Interaction } from '../../../render/interaction';
import type { Viewport } from '../../../render/viewport';

export const runtime: { vp: Viewport | null; ix: Interaction | null } = { vp: null, ix: null };
