# Project conventions
- Tunnel is an independent lazy-loaded protected route; it projects AppContext tasks and reuses TaskEditPopup so existing scheduling and persistence stay authoritative.
- Tunnel date/hour projection lives in a pure TypeScript module with rule tests; UTC calendar ordinals avoid DST shifts and deadlines never represent execution duration.
- Memory media use the existing vault index and signed URL action; do not duplicate user files or introduce a separate storage system.
- Three.js materials resolve semantic CSS tokens and local procedural textures; avoid external runtime fonts/HDR assets.